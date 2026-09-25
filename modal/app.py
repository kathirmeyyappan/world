"""kathir world on Modal.

Two Servers in one App:

  Lobby  unauthenticated. Serves the built client and brokers room sessions: POST /api/rooms/{id}
         starts (or reuses) a session on the Room server and hands the browser the token.
  Room   sessioned. Runs the Node room server; the proxy pins every WebSocket carrying a session
         token to the container that owns that session, and stamps x-modal-server-session-id on it.

See docs/multiplayer-flow.png for the request flow. Deploy with `modal deploy modal/app.py`.
"""

import subprocess
from pathlib import Path

import modal

APP_NAME = "kathir-world"
ROOM_PORT = 8000
LOBBY_PORT = 8000
SESSION_IDLE_TIMEOUT = 3600  # an open WebSocket keeps a session alive; this only reaps empty rooms
REPO = Path(__file__).resolve().parent.parent

app = modal.App(APP_NAME)

image = (
    modal.Image.from_registry("node:22-slim", add_python="3.12")
    .uv_pip_install("fastapi[standard]>=0.115")
    .workdir("/app")
    .add_local_dir(
        REPO,
        "/app",
        copy=True,
        ignore=["node_modules", "dist", ".git", "e2e/out", "__pycache__", "*.local", "docs"],
    )
    .run_commands("npm ci", "npm run build")
)

rooms = modal.Dict.from_name(f"{APP_NAME}-rooms", create_if_missing=True)


@app.server(image=image, port=ROOM_PORT, target_concurrency=64, startup_timeout=60, exit_grace_period=30)
@modal.sessioned()
class Room:
    @modal.enter()
    def start(self):
        self.proc = subprocess.Popen(
            ["node", "packages/server/dist/server.cjs"],
            cwd="/app",
            env={"PORT": str(ROOM_PORT), "PATH": "/usr/local/bin:/usr/bin:/bin"},
        )

    @modal.exit()
    def stop(self):
        self.proc.terminate()
        self.proc.wait(timeout=10)


@app.server(image=image, port=LOBBY_PORT, unauthenticated=True, target_concurrency=200, startup_timeout=60)
class Lobby:
    @modal.enter()
    def start(self):
        import threading

        import uvicorn

        self.thread = threading.Thread(
            target=uvicorn.run,
            kwargs={"app": build_lobby(), "host": "0.0.0.0", "port": LOBBY_PORT, "log_level": "warning"},
            daemon=True,
        )
        self.thread.start()


def build_lobby():
    import re

    from fastapi import FastAPI, HTTPException
    from fastapi.staticfiles import StaticFiles
    from pydantic import BaseModel

    room_server = modal.Server.from_name(APP_NAME, "Room")
    room_id_re = re.compile(r"^[a-z0-9][a-z0-9-]{0,23}$")

    class JoinRequest(BaseModel):
        fresh: bool = False

    api = FastAPI()

    @api.post("/api/rooms/{room_id}")
    async def join_room(room_id: str, body: JoinRequest | None = None):
        if not room_id_re.match(room_id):
            raise HTTPException(400, "invalid room id")
        fresh = bool(body and body.fresh)
        entry = None if fresh else await rooms.get.aio(room_id)
        if entry is None:
            session = await room_server.sessions.start.aio(idle_timeout=SESSION_IDLE_TIMEOUT)
            entry = {"session_id": session.session_id, "token": session.token}
            await rooms.put.aio(room_id, entry)
        url = await room_server.get_url.aio()
        ws_url = re.sub(r"^http", "ws", url.rstrip("/")) + "/ws"
        return {"room_id": room_id, "ws_url": ws_url, "token": entry["token"]}

    @api.get("/healthz")
    async def healthz():
        return {"ok": True}

    api.mount("/", StaticFiles(directory="/app/packages/client/dist", html=True), name="client")
    return api
