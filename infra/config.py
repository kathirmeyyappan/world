from pathlib import Path

APP_NAME = "kathir-world"
REPO = Path(__file__).resolve().parent.parent

ROOM_PORT = 8000
# Note: idle timeout is higher than the room cleanup grace period, meaning sessions might outlive the room.
SESSION_IDLE_TIMEOUT = 300
MAX_SESSIONS_PER_CONTAINER = 64
TARGET_SESSIONS_PER_CONTAINER = 2