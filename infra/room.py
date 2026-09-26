"""The sessioned room server.

Modal's proxy routes every request that carries a session cookie to the container owning that
session and stamps `x-modal-server-session-id` on it; the Node server keys rooms by it. The same
Node process serves the client bundle so page and WebSocket share an origin.
"""

import subprocess

import modal

from .common import app, room_image
from .config import ROOM_PORT, MAX_SESSIONS_PER_CONTAINER


@app.server(
    name="room",
    image=room_image,
    port=ROOM_PORT,
    max_concurrency=MAX_SESSIONS_PER_CONTAINER,
    # Starting a session needs a container to land on and does not scale the Server up from zero,
    # so keep one warm. Costs an idle container.
    min_containers=1,
    startup_timeout=120,
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
