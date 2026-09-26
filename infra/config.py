from pathlib import Path

APP_NAME = "kathir-world"
REPO = Path(__file__).resolve().parent.parent

ROOM_PORT = 8000
# An open WebSocket keeps a session alive, so this only decides how long an empty room lingers.
SESSION_IDLE_TIMEOUT = 300
# WebSockets per Room container before the autoscaler adds another. A session pins a whole room
# to one container, so this only spreads distinct rooms.
MAX_SESSIONS_PER_CONTAINER = 64
