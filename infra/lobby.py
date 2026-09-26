"""The lobby: brokers room sessions for the static client.

POST /api/rooms/{id} looks the room up in a Dict, starts a session on the Room server if there is
none (or the caller asks for a fresh one), and returns the WebSocket URL plus the session token.
The lobby is the only component that ever holds proxy auth. `Room` is referenced directly rather
than via `Server.from_name` so the same code works under `modal serve` (ephemeral app) and
`modal deploy`.
"""

import re

import modal

from .common import app, lobby_image, rooms
from .config import ALLOWED_ORIGINS, SESSION_IDLE_TIMEOUT
from .room import Room

ROOM_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,23}$")


def build_api():
    from fastapi import FastAPI, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel

    class JoinRequest(BaseModel):
        fresh: bool = False

    api = FastAPI()
    api.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_methods=["POST", "GET"], allow_headers=["*"])

    @api.post("/api/rooms/{room_id}")
    async def join_room(room_id: str, body: JoinRequest | None = None):
        if not ROOM_ID.match(room_id):
            raise HTTPException(400, "invalid room id")
        fresh = bool(body and body.fresh)
        entry = None if fresh else await rooms.get.aio(room_id)
        if entry is None:
            session = await Room.sessions.start.aio(idle_timeout=SESSION_IDLE_TIMEOUT)
            entry = {"session_id": session.session_id, "token": session.token}
            await rooms.put.aio(room_id, entry)
        url = await Room.get_url.aio()
        ws_url = re.sub(r"^http", "ws", url.rstrip("/")) + "/ws"
        return {"room_id": room_id, "ws_url": ws_url, "token": entry["token"]}

    @api.get("/healthz")
    async def healthz():
        return {"ok": True}

    return api


@app.function(image=lobby_image)
@modal.asgi_app()
def lobby():
    return build_api()
