from __future__ import annotations

import asyncio
import math
import os
import selectors
import shutil
import socket
import subprocess
import time
from collections.abc import Iterator
from pathlib import Path

import pytest

from bots.circle_bot import run_circle_bot
from bots.observer_bot import run_observer_bot
from common import RoomConnectionError, Snapshot, connect

ROOT = Path(__file__).resolve().parents[2]


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@pytest.fixture
def room_server() -> Iterator[str]:
    if shutil.which("node") is None or not (ROOT / "node_modules" / "tsx").exists():
        pytest.skip("Node dependencies are required for the real-server contract test")

    port = free_port()
    process = subprocess.Popen(
        [
            "node",
            "--import",
            "tsx",
            "packages/server/src/index.ts",
        ],
        cwd=ROOT,
        env={**os.environ, "PORT": str(port)},
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    assert process.stdout is not None
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    deadline = time.monotonic() + 10
    ready = False
    while time.monotonic() < deadline:
        if process.poll() is not None:
            stderr = process.stderr.read() if process.stderr else ""
            raise RuntimeError(f"room server exited early: {stderr}")
        for key, _events in selector.select(timeout=0.1):
            line = key.fileobj.readline()
            if "listening" in line:
                ready = True
                break
        if ready:
            break
    selector.close()
    if not ready:
        process.terminate()
        raise RuntimeError("timed out waiting for room server")

    try:
        yield f"ws://127.0.0.1:{port}/ws"
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


async def seat_person(room_server: str, room: str):
    """A bot can't join a room with no people in it, so every scenario seats one first."""
    return await connect(None, room, "person", direct_url=room_server, bot=False)


def test_a_bot_never_joins_an_empty_room(room_server: str) -> None:
    async def scenario() -> None:
        with pytest.raises(RoomConnectionError, match="no one here"):
            await connect(None, "python-empty", "observer", direct_url=room_server)

    asyncio.run(scenario())


def test_connects_and_decodes_real_room_server(room_server: str) -> None:
    async def scenario() -> None:
        person = await seat_person(room_server, "python-contract")
        connection = await connect(
            None,
            "python-contract",
            "observer",
            direct_url=room_server,
        )
        try:
            assert connection.transport == "direct"
            assert connection.welcome.room == "python-contract"
            assert connection.welcome.id.startswith("p")
            me = next(p for p in connection.welcome.players if p.id == connection.id)
            assert me.bot, "the server flags us as a bot from the join URL"

            while True:
                message = await asyncio.wait_for(connection.receive(), timeout=2)
                if isinstance(message, Snapshot):
                    assert message.tick > connection.welcome.tick
                    assert any(player.id == connection.id for player in message.players)
                    break
        finally:
            await connection.close()
            await person.close()

    asyncio.run(scenario())


def test_observer_reports_real_snapshots(room_server: str) -> None:
    async def scenario() -> dict:
        person = await seat_person(room_server, "python-observer")
        try:
            return await run_observer_bot(
                "python-observer",
                "observer",
                seconds=0.25,
                direct_ws_url=room_server,
            )
        finally:
            await person.close()

    report = asyncio.run(scenario())

    assert report["completed"]
    assert report["transport"] == "direct"
    assert report["requested_room"] == "python-observer"
    assert report["session_room"] == "python-observer"
    assert report["snapshots"] >= 2
    assert report["last_tick"] > report["first_tick"]
    assert report["event_counts"]["welcome"] == 1
    assert report["event_counts"]["snap"] == report["snapshots"]
    assert report["final_state"]["self_id"] == report["observer_id"]


def test_circle_bot_orbits_the_only_other_player(room_server: str) -> None:
    async def scenario() -> tuple[dict[str, object], list[tuple[float, float]], str]:
        target = await connect(
            None,
            "python-circle",
            "target",
            direct_url=room_server,
            bot=False,
        )
        positions: list[tuple[float, float]] = []
        circle = asyncio.create_task(
            run_circle_bot(
                "python-circle",
                seconds=0.6,
                direct_ws_url=room_server,
            )
        )
        try:
            while not circle.done():
                message = await asyncio.wait_for(target.receive(), timeout=2)
                if isinstance(message, Snapshot):
                    player = next(
                        (player for player in message.players if player.name == "circle-bot"),
                        None,
                    )
                    if player:
                        positions.append((player.pos.x, player.pos.z))
            return await circle, positions, target.id
        finally:
            await target.close()

    report, positions, target_id = asyncio.run(scenario())

    assert report["completed"]
    assert report["target"] == target_id
    assert len(positions) >= 2
    assert math.hypot(
        positions[-1][0] - positions[0][0],
        positions[-1][1] - positions[0][1],
    ) > 0.5
