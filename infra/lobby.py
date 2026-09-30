"""Lobby turns a room id into a session (which lives on Room server) and sends the browser there.

GET /join/{id} looks the room up in a Dict, starts a session if there is none or it died, and
redirects to the Room server with the token in the query string. The proxy answers that with a
307 that moves the token into a host-bound cookie, and the Room's Node process then serves the
page; the game's WebSocket is same-origin from there, so the cookie covers it.

The lobby is the only component that ever holds proxy auth. It never imports `room.py`: executing
the `@app.server` decorator inside this container stalls it. Instead it takes a handle to the Room
server by id, from the ids Modal hands every container of the running app, which works under both
`modal serve` (ephemeral app, no name to look up) and `modal deploy`.
"""

import asyncio
import re
from collections.abc import Callable, Coroutine
from typing import TYPE_CHECKING, Any, cast

import modal

from .common import app, lobby_image, rooms
from .config import APP_NAME, SESSION_IDLE_TIMEOUT, WARMUP_SESSION_IDLE_TIMEOUT

if TYPE_CHECKING:
    from fastapi import FastAPI

# What the rooms Dict holds per room code: the live session's id and its proxy token.
Session = dict[str, str]

ROOM_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,23}$")


def room_server() -> modal.Server:
    """Handle to the Room server without importing its module.

    `Server.from_id` with the id Modal hands this container works for ephemeral (`modal serve`)
    and deployed apps alike, but only newer clients have it; older ones fall back to a lookup by
    name, which needs the app to be deployed."""
    from modal.app import _App

    container_app = _App._get_container_app()
    running = container_app._running_app if container_app is not None else None
    server: modal.Server
    if running is not None and hasattr(modal.Server, "from_id"):
        server = modal.Server.from_id(running.function_ids["Room"])
    else:
        server = modal.Server.from_name(APP_NAME, "Room")
    return server


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


async def live_session(room_id: str, room_url: str) -> Session | None:
    """The room's cached session, if it is still alive."""
    entry_info: Session | None = await rooms.get.aio(room_id)
    if entry_info is not None and await session_alive(room_url, entry_info["token"]):
        return entry_info
    return None


async def start_session(room_id: str) -> Session:
    """Start a fresh session for the room and cache it."""
    session = await room_server().sessions.start.aio(idle_timeout=SESSION_IDLE_TIMEOUT)
    entry_info: Session = {"session_id": session.session_id, "token": session.token}
    await rooms.put.aio(room_id, entry_info)
    return entry_info


async def warm_room() -> None:
    """Boot a Room container before anyone needs it: a session start is what makes the Room scale up
    from zero, so start one that ends five seconds later. The container then waits its scaledown
    window for the real join. Best effort; a failure here only costs the head start."""
    try:
        await room_server().sessions.start.aio(idle_timeout=WARMUP_SESSION_IDLE_TIMEOUT)
    except Exception as e:  # noqa: BLE001
        print(f"room warm-up failed: {e}")


def build_api(warm: Callable[[], Coroutine[Any, Any, None]] = warm_room) -> "FastAPI":
    from urllib.parse import urlencode, urlparse

    from fastapi import FastAPI, HTTPException, Request
    from fastapi.responses import RedirectResponse

    api = FastAPI()

    @api.get("/join/{room_id}")
    async def join(request: Request, room_id: str, name: str = "", bot: str = "") -> RedirectResponse:
        """Join a room, creating one if necessary. A bot (`bot=1`, what the bot framework sends)
        only joins a room that is already running: bots don't keep rooms open, so one must never
        start a room either."""
        print(f"Attempting to join room {room_id} with name {name}")

        room_id = room_id.lower()
        if not ROOM_ID.match(room_id):
            raise HTTPException(400, "invalid room id")

        # get_url() is typed Optional; a deployed Server always has one. cast() is a no-op at runtime.
        room_url = cast(str, await room_server().get_url.aio()).rstrip("/")
        entry_info = await live_session(room_id, room_url)
        if entry_info is None:
            if bot == "1":
                raise HTTPException(409, "no one here")
            entry_info = await start_session(room_id)
        lobby_url = (await lobby.get_web_url.aio() or "").rstrip("/")
        # Where the player came from (the launcher), so the room page can send them back to it.
        home = urlparse(request.headers.get("referer", ""))
        params = {
            "modal_session_token": entry_info["token"],
            "room": room_id,
            "direct": "1",
            "name": name,
            "lobby": lobby_url,
        }
        if home.scheme and home.netloc:
            params["home"] = f"{home.scheme}://{home.netloc}"
        query = urlencode(params)
        return RedirectResponse(f"{room_url}/?{query}", status_code=302)

    # response_model=None: FastAPI would otherwise turn the return annotation into a response model.
    @api.get("/healthz", response_model=None)
    async def healthz() -> dict[str, bool]:
        """The launcher pings this on load: it wakes the lobby and, in the background, a Room."""
        asyncio.create_task(warm())
        return {"ok": True}

    return api


# Not kept warm: the launcher pings /healthz on load, which wakes this container (and a Room, see
# warm_room) before Join is clicked. The longer idle window gives the player five minutes to click it.
@app.function(image=lobby_image, scaledown_window=1200, max_containers=1)
@modal.asgi_app()
def lobby() -> "FastAPI":
    return build_api()
