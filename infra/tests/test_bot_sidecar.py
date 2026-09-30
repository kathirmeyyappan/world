from __future__ import annotations

import json
import socket
import urllib.error
import urllib.request
from typing import Any

from infra.bot_sidecar import start_bot_sidecar


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def post(port: int, body: object) -> tuple[int, str]:
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/bots",
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=2) as res:
            return res.status, res.read().decode()
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode()


def test_sidecar_spawns_from_the_room_request_and_reports_failures() -> None:
    calls: list[tuple[str, str, float, dict[str, Any]]] = []

    def spawn(bot: str, room: str, seconds: float, placement: dict[str, Any]) -> str:
        if bot == "broken":
            raise RuntimeError("modal says no")
        calls.append((bot, room, seconds, placement))
        return "fc-123"

    port = free_port()
    server = start_bot_sidecar(port, spawn)
    try:
        assert post(port, {"bot": "circle", "room": "late-night", "seconds": 60, "caller": "kathir"}) == (202, "fc-123")
        placed = {"spawn": {"x": 112, "y": 20, "z": 0}, "avatar": "elizabeth"}
        assert (
            post(port, {"bot": "stalker", "room": "late-night", "seconds": 600, "caller": "room", **placed})[0] == 202
        )
        assert calls == [
            ("circle", "late-night", 60.0, {}),
            ("stalker", "late-night", 600.0, {"spawn": {"x": 112.0, "y": 20.0, "z": 0.0}, "avatar": "elizabeth"}),
        ]
        status, text = post(port, {"bot": "broken", "room": "x", "seconds": 5})
        assert status == 502 and "modal says no" in text
        assert post(port, {"room": "x"})[0] == 400
        assert post(port, {"bot": "stalker", "room": "x", "seconds": 5, "spawn": {"x": 1}})[0] == 400
    finally:
        server.shutdown()
