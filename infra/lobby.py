"""Lobby turns a room id into a session (which lives on Room server) and sends the browser there.

GET /join/{id} looks the room up in a Dict, starts a session if there is none (or ?fresh=1), and
redirects to the Room server with the token in the query string. The proxy answers that with a
307 that moves the token into a host-bound cookie, and the Room's Node process then serves the
page; the game's WebSocket is same-origin from there, so the cookie covers it.

The lobby is the only component that ever holds proxy auth. `Room` is referenced directly rather
than via `Server.from_name` so the same code works under `modal serve` and `modal deploy`.
"""

import re

import modal

from .common import app, lobby_image, rooms
from .config import SESSION_IDLE_TIMEOUT
from .room import Room

ROOM_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,23}$")


async def room_entry(room_id: str, fresh: bool) -> dict:
    """Get or create a room entry for given room id"""
    if not fresh:
        entry = await rooms.get.aio(room_id)
        if entry is not None:
            return entry
    session = await Room.sessions.start.aio(idle_timeout=SESSION_IDLE_TIMEOUT)
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
        entry = await room_entry(room_id, fresh)
        room_url = (await Room.get_url.aio()).rstrip("/")
        query = urlencode({"modal_session_token": entry["token"], "room": room_id, "direct": "1", "name": name})
        return RedirectResponse(f"{room_url}/?{query}", status_code=302)

    @api.get("/healthz")
    async def healthz():
        return {"ok": True}

    return api


@app.function(image=lobby_image)
@modal.asgi_app()
def lobby():
    return build_api()
