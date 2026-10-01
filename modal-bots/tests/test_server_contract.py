from __future__ import annotations

import asyncio
import copy
import itertools
import math
import os
import selectors
import shutil
import socket
import subprocess
import time
from collections.abc import Iterator
from contextlib import suppress
from pathlib import Path
from typing import Any

import pytest
from bots import sniper_bot
from bots.circle_bot import run_circle_bot
from bots.observer_bot import run_observer_bot
from bots.sniper_bot import run_sniper_bot
from bots.stalker_bot import run_stalker_bot
from common import Connection, Controls, Event, RoomConnectionError, Snapshot, Vec3, WorldState, connect, run_input_loop
from common.navigation import Route
from common.world import Region, load_world_map

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
        for _key, _events in selector.select(timeout=0.1):
            line = process.stdout.readline()
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


async def seat_person(room_server: str, room: str) -> Connection:
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
    async def scenario() -> dict[str, Any]:
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
    assert (
        math.hypot(
            positions[-1][0] - positions[0][0],
            positions[-1][1] - positions[0][1],
        )
        > 0.5
    )


def test_stalker_stands_where_it_asks_watches_the_person_and_dies_to_kill_bots(room_server: str) -> None:
    async def scenario() -> tuple[dict[str, object], float]:
        person = await seat_person(room_server, "python-stalker")
        stalker = asyncio.create_task(
            run_stalker_bot(
                "python-stalker",
                seconds=30,
                direct_ws_url=room_server,
                spawn=Vec3(112, 20, 0),
                avatar="elizabeth",
            )
        )
        started = time.monotonic()
        try:
            while True:
                message = await asyncio.wait_for(person.receive(), timeout=2)
                if not isinstance(message, Snapshot):
                    continue
                me = next(p for p in message.players if p.id == person.id)
                bot = next((p for p in message.players if p.name == "stalker-bot"), None)
                if bot is None:
                    continue
                assert (bot.pos.x, bot.pos.y, bot.pos.z) == pytest.approx((112, 21.7, 0)), "on floor 1"
                assert bot.avatar == "elizabeth"
                facing = math.atan2(me.pos.x - bot.pos.x, me.pos.z - bot.pos.z)
                if abs(math.remainder(bot.yaw - facing, math.tau)) < 1e-6:
                    break
            await person.send({"t": "chat", "text": "/kill-bots"})
            return await asyncio.wait_for(stalker, timeout=10), time.monotonic() - started
        finally:
            await person.close()

    report, took = asyncio.run(scenario())

    assert not report["completed"], "the run ends when its corpse is dropped, not at 30 s"
    assert took < 10
    assert report["watching"] is not None


def test_a_route_walks_up_the_tower_stair_and_out_onto_a_balcony(room_server: str) -> None:
    world = load_world_map()
    angle = math.radians(255)  # a floor-1 balcony door, just past where the stair's first flight ends
    goal = world.node_at(Vec3(112 + 21.5 * math.cos(angle), 20, 21.5 * math.sin(angle)))
    assert goal is not None

    async def scenario() -> Vec3:
        person = await seat_person(room_server, "python-route")
        walker = await connect(None, "python-route", "walker", direct_url=room_server, spawn=Vec3(91, 0, 0))
        state = WorldState(walker.welcome, walker.room)
        controls = Controls(walker)
        stop = asyncio.Event()
        inputs = asyncio.create_task(run_input_loop(controls, stop))
        route: Route | None = None
        try:
            async with asyncio.timeout(30):
                while True:
                    state.apply(await walker.receive())
                    me = state.me
                    assert me is not None
                    if route is None or route.stuck(state.tick):
                        start = world.node_at(Vec3(me.pos.x, me.pos.y - 1.7, me.pos.z))
                        assert start is not None
                        path = world.path(start, goal)
                        assert path is not None
                        route = Route(world, path, state.tick)
                    if not route.steer(me.pos, state.tick, controls):
                        return me.pos
        finally:
            stop.set()
            inputs.cancel()
            with suppress(asyncio.CancelledError, RoomConnectionError):
                await inputs
            await walker.close()
            await person.close()

    eye = asyncio.run(scenario())
    assert eye.y == pytest.approx(21.7), "on floor 1"
    assert math.hypot(eye.x - 112, eye.z) > 20, "outside the wall"


def test_sniper_fires_at_a_person_in_sight_then_waits_out_its_cooldown(
    room_server: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Chest shots only: a headshot kills at once and there'd be no second shot to time.
    monkeypatch.setattr(sniper_bot, "AIM_ZONES", {"chest": 1.0})

    async def scenario() -> tuple[list[int], dict[str, Any]]:
        person = await seat_person(room_server, "python-sniper")
        me = next(p for p in person.welcome.players if p.id == person.id)
        # It starts on a tower floor; here the only "floor" is a spot on the open main disc, 20 m
        # nearer its middle than the person, with nothing in the way.
        away = 20 / max(1.0, math.hypot(me.pos.x, me.pos.z))
        world = copy.copy(load_world_map())
        world.tower_inside = (Region("disc", me.pos.x * (1 - away), me.pos.z * (1 - away), 0),)
        sniper = asyncio.create_task(run_sniper_bot("python-sniper", seconds=8, world=world, direct_ws_url=room_server))
        shot_ticks: list[int] = []
        tick = person.welcome.tick
        try:
            while not sniper.done():
                message = await asyncio.wait_for(person.receive(), timeout=2)
                if isinstance(message, Snapshot):
                    tick = message.tick
                elif isinstance(message, Event) and message.t == "shot" and message.data["id"] != person.id:
                    shot_ticks.append(tick)
            return shot_ticks, await sniper
        finally:
            await person.close()

    shot_ticks, report = asyncio.run(scenario())

    assert report["shots"] >= 2 and len(shot_ticks) == report["shots"], report
    assert all(b - a >= 90 for a, b in itertools.pairwise(shot_ticks)), f"3 s between shots: {shot_ticks}"
