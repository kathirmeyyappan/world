"""Localhost HTTP sidecar the Node room server calls to start bots.

The Room container's Python process already carries the container's Modal credentials, so it,
not Node, spawns `kathir-world-bots/run_bot`. One route: POST /bots with the JSON BotRequest
that packages/shared defines ({bot, room, seconds, caller}); 202 with the function call id when
queued, 4xx for a bad request, 502 when Modal refuses. Bound to 127.0.0.1 only.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .config import BOTS_APP_NAME, BOTS_FUNCTION_NAME

# Spawns a bot and returns an id for the logs. Swapped for a fake in tests.
Spawner = Callable[[str, str, float], str]


def spawn_on_modal(bot: str, room: str, seconds: float) -> str:
    import modal

    fn = modal.Function.from_name(BOTS_APP_NAME, BOTS_FUNCTION_NAME)
    return fn.spawn(bot=bot, room=room, seconds=seconds).object_id


def start_bot_sidecar(port: int, spawn: Spawner = spawn_on_modal) -> ThreadingHTTPServer:
    """Serve POST /bots on 127.0.0.1:port in a daemon thread; returns the server for shutdown."""

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802 (http.server naming)
            if self.path != "/bots":
                return self._reply(404, "not found")
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("content-length", "0"))))
                bot, room, seconds = str(body["bot"]), str(body["room"]), float(body["seconds"])
            except (ValueError, KeyError, TypeError):
                return self._reply(400, "expected {bot, room, seconds}")
            try:
                call_id = spawn(bot, room, seconds)
            except Exception as exc:  # noqa: BLE001 (any Modal failure is a 502 to Node)
                return self._reply(502, f"{type(exc).__name__}: {exc}")
            self._reply(202, call_id)

        def _reply(self, status: int, text: str) -> None:
            data = text.encode()
            self.send_response(status)
            self.send_header("content-type", "text/plain; charset=utf-8")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, fmt: str, *args: object) -> None:
            print(f"bot sidecar: {fmt % args}", flush=True)

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, name="bot-sidecar", daemon=True).start()
    return server
