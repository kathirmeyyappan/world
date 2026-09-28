"""The sessioned room server.

Modal's proxy routes every request that carries a session cookie to the container owning that
session and stamps `x-modal-server-session-id` on it; the Node server keys rooms by it. The same
Node process serves the client bundle so page and WebSocket share an origin.
"""

import subprocess

import modal

from .bot_sidecar import start_bot_sidecar
from .common import app, room_image
from .config import (
    APP_NAME,
    BOT_SIDECAR_PORT,
    MAX_SESSIONS_PER_CONTAINER,
    ROOM_PORT,
    ROOM_SCALEDOWN_WINDOW,
    SESSION_QUEUE_TIMEOUT,
    TARGET_SESSIONS_PER_CONTAINER,
)


def lobby_url() -> str:
    """The lobby's public URL, for the page the Node server serves. A tab that lands on this host
    without the lobby's redirect params (a pasted URL, a fresh tab) still needs to know where the
    lobby is to join a room. Resolved by id like lobby.py does for the Room, so it works under
    `modal serve` too; empty if anything fails, which only loses that fallback."""
    try:
        from modal.app import _App

        container_app = _App._get_container_app()
        running = container_app._running_app if container_app is not None else None
        if running is not None and hasattr(modal.Function, "from_id"):
            fn = modal.Function.from_id(running.function_ids["lobby"])
        else:
            fn = modal.Function.from_name(APP_NAME, "lobby")
        return (fn.get_web_url() or "").rstrip("/")
    except Exception as e:  # noqa: BLE001
        print(f"lobby url unavailable: {e}")
        return ""


@app.server(
    image=room_image,
    port=ROOM_PORT,
    target_concurrency=TARGET_SESSIONS_PER_CONTAINER,
    max_concurrency=MAX_SESSIONS_PER_CONTAINER,
    min_containers=0,  # the lobby warms one up when the launcher loads (see lobby.py)
    max_containers=10,  # guard against runaway scaling
    scaledown_window=ROOM_SCALEDOWN_WINDOW,
    startup_timeout=120,
    exit_grace_period=30,
    experimental_options={"queue_timeout": SESSION_QUEUE_TIMEOUT},  # session starts wait for a cold boot
)
@modal.sessioned()
class Room:
    @modal.enter()
    def start(self):
        # Bots called from chat: Node posts to this sidecar, which spawns them with this
        # container's own Modal credentials.
        self.sidecar = start_bot_sidecar(BOT_SIDECAR_PORT)
        self.proc = subprocess.Popen(
            ["node", "packages/server/dist/server.cjs"],
            cwd="/app",
            env={
                "PORT": str(ROOM_PORT),
                "PATH": "/usr/local/bin:/usr/bin:/bin",
                "STATIC_DIR": "/app/packages/client/dist",
                "LOBBY_URL": lobby_url(),
                "BOT_SPAWNER_URL": f"http://127.0.0.1:{BOT_SIDECAR_PORT}/bots",
            },
        )

    @modal.exit()
    def stop(self):
        self.sidecar.shutdown()
        self.proc.terminate()
        self.proc.wait(timeout=10)
