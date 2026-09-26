"""Lobby turns a room id into a session (which lives on Room server) and sends the browser there.

GET /join/{id} looks the room up in a Dict, starts a session if there is none (or ?fresh=1), and
redirects to the Room server with the token in the query string. The proxy answers that with a
307 that moves the token into a host-bound cookie, and the Room's Node process then serves the
page; the game's WebSocket is same-origin from there, so the cookie covers it.

The lobby is the only component that ever holds proxy auth. It never imports `room.py`: executing
the `@app.server` decorator inside this container stalls it. Instead it takes a handle to the Room
server by id, from the ids Modal hands every container of the running app, which works under both
`modal serve` (ephemeral app, no name to look up) and `modal deploy`.
"""

import re

import modal

from .common import app, lobby_image, rooms
from .config import APP_NAME, SESSION_IDLE_TIMEOUT

ROOM_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,23}$")


def room_server() -> modal.Server:
    """Handle to the Room server without importing its module."""
    from modal.app import _App

    container_app = _App._get_container_app()
    if container_app is not None and container_app._running_app is not None:
        return modal.Server.from_id(container_app._running_app.function_ids["Room"])
    return modal.Server.from_name(APP_NAME, "Room")


async def session_alive(room_url: str, token: str) -> bool:
    """One authenticated request to the Room host. The proxy rejects tokens for sessions that idled
    out, expired, or belonged to a previous deployment."""
    import httpx

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(f"{room_url}/healthz", headers={"Modal-Authorization": f"Bearer {token}"})
        return res.status_code == 200
    except httpx.HTTPError:
        return False


async def room_entry(room_id: str, room_url: str, fresh: bool) -> dict:
    """Get the room's session, starting a new one if there is none or the cached one is dead."""
    if not fresh:
        entry = await rooms.get.aio(room_id)
        if entry is not None and await session_alive(room_url, entry["token"]):
            return entry
    session = await room_server().sessions.start.aio(idle_timeout=SESSION_IDLE_TIMEOUT)
    entry = {"session_id": session.session_id, "token": session.token}
    await rooms.put.aio(room_id, entry)
    return entry


def build_api():
    from urllib.parse import urlencode

    from fastapi import FastAPI, HTTPException
    from fastapi.responses import RedirectResponse

    api = FastAPI()

    @api.get("/join/{room_id}")
    async def join(room_id: str, name: str = "", fresh: bool = False):
        """Join a room, creating one if necessary"""
        room_id = room_id.lower()
        if not ROOM_ID.match(room_id):
            raise HTTPException(400, "invalid room id")
        room_url = (await room_server().get_url.aio()).rstrip("/")
        entry = await room_entry(room_id, room_url, fresh)
        lobby_url = (await lobby.get_web_url.aio() or "").rstrip("/")
        query = urlencode(
            {"modal_session_token": entry["token"], "room": room_id, "direct": "1", "name": name, "lobby": lobby_url}
        )
        return RedirectResponse(f"{room_url}/?{query}", status_code=302)

    @api.get("/healthz")
    async def healthz():
        return {"ok": True}

    return api


@app.function(image=lobby_image)
@modal.asgi_app()
def lobby():
    return build_api()
