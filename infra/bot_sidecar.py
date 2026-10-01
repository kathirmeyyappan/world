"""Localhost HTTP sidecar the Node room server calls to start bots.

The Room container's Python process already carries the container's Modal credentials, so it,
not Node, spawns the bots app's workers. One route per worker, POST /bots/<worker> with the JSON
BotRequest that packages/shared defines ({bot, room, seconds, caller}, optionally spawn {x, y, z}
and avatar, and for a combat bot targets [names]); 202 with the function call id when queued, 4xx
for a bad request, 502 when Modal refuses. Bound to 127.0.0.1 only.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Callable
from functools import cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import TYPE_CHECKING, Any

from .config import BOTS_APP_NAME, BOTS_FUNCTIONS

if TYPE_CHECKING:
    import modal

# Spawns the named bots-app function with these keyword arguments and returns an id for the
# logs. Swapped for a fake in tests.
Spawner = Callable[[str, dict[str, Any]], str]


def spawn_on_modal(function: str, kwargs: dict[str, Any]) -> str:
    return str(_function(function).spawn(**kwargs).object_id)


@cache
def _function(name: str) -> modal.Function[..., Any, Any]:
    """Each worker looked up and hydrated once, on its first call, then reused."""
    import modal

    fn = modal.Function.from_name(BOTS_APP_NAME, name)
    fn.hydrate()
    return fn


def _arguments(worker: str, body: dict[str, Any]) -> dict[str, Any]:
    """The worker's keyword arguments from a request body; raises on a malformed one."""
    kwargs: dict[str, Any] = {"bot": str(body["bot"]), "room": str(body["room"]), "seconds": float(body["seconds"])}
    if "spawn" in body:
        kwargs["spawn"] = {axis: float(body["spawn"][axis]) for axis in ("x", "y", "z")}
    if "avatar" in body:
        kwargs["avatar"] = str(body["avatar"])
    if worker == "combat":
        targets = body.get("targets", [])
        if not isinstance(targets, list):
            raise TypeError("targets must be a list")
        kwargs["targets"] = [str(name) for name in targets]
    return kwargs


def start_bot_sidecar(port: int, spawn: Spawner = spawn_on_modal) -> ThreadingHTTPServer:
    """Serve POST /bots/<worker> on 127.0.0.1:port in a daemon thread; returns the server."""

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            worker = self.path.removeprefix("/bots/")
            if worker not in BOTS_FUNCTIONS:
                return self._reply(404, "not found")
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("content-length", "0"))))
                kwargs = _arguments(worker, body)
            except (ValueError, KeyError, TypeError):
                return self._reply(400, "expected {bot, room, seconds}, optionally spawn {x, y, z}, avatar and targets")
            try:
                call_id = spawn(BOTS_FUNCTIONS[worker], kwargs)
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
