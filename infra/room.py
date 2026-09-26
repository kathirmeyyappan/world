"""The sessioned room server.

Modal's proxy routes every request that carries a session cookie to the container owning that
session and stamps `x-modal-server-session-id` on it; the Node server keys rooms by it. The same
Node process serves the client bundle so page and WebSocket share an origin.
"""

import subprocess

import modal

from .common import app, room_image
from .config import ROOM_PORT, ROOM_TARGET_CONCURRENCY


@app.server(
    image=room_image,
    port=ROOM_PORT,
    target_concurrency=ROOM_TARGET_CONCURRENCY,
    startup_timeout=60,
    exit_grace_period=30,
)
@modal.sessioned()
class Room:
    @modal.enter()
    def start(self):
        self.proc = subprocess.Popen(
            ["node", "packages/server/dist/server.cjs"],
            cwd="/app",
            env={
                "PORT": str(ROOM_PORT),
                "PATH": "/usr/local/bin:/usr/bin:/bin",
                "STATIC_DIR": "/app/packages/client/dist",
            },
        )

    @modal.exit()
    def stop(self):
        self.proc.terminate()
        self.proc.wait(timeout=10)
