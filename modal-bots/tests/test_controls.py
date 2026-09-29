from __future__ import annotations

import asyncio
import math
from typing import Any

import pytest
from common import Controls, Cube, Player, Vec3, Welcome


class FakeConnection:
    def __init__(self) -> None:
        me = Player(
            id="p1",
            name="bot",
            color="#fff",
            pos=Vec3(0, 1.7, 0),
            vy=0,
            yaw=0,
            pitch=0,
            last_seq=7,
            reading=None,
            boost=0,
            item=None,
            scoped=False,
            firing=False,
            avatar="standard",
            avatar_locked=False,
            hearts=10,
            kills=0,
            bot=False,
            dead=False,
        )
        self.id = me.id
        self.welcome = Welcome("p1", "room", 0, (me,), ())
        self.sent: list[dict[str, Any]] = []

    async def send(self, message: dict[str, Any]) -> None:
        self.sent.append(message)


def test_controls_build_frames_and_reset_one_shot_inputs() -> None:
    connection = FakeConnection()
    controls = Controls(connection)  # type: ignore[arg-type]
    controls.move(forward=1, right=1)
    controls.look_at(Vec3(0, 1.7, 0), Vec3(1, 1.7, 0))
    controls.jump()
    controls.fire_once()
    controls.scope()
    controls.read_cube(Cube("aws", 1, 2, 3, 0, 0))

    asyncio.run(controls.send_input())
    asyncio.run(controls.send_input())

    first = connection.sent[0]["f"]
    second = connection.sent[1]["f"]
    assert first["seq"] == 8
    assert first["mx"] == pytest.approx(1 / math.sqrt(2))
    assert first["my"] == pytest.approx(1 / math.sqrt(2))
    assert first["yaw"] == pytest.approx(math.pi / 2)
    assert first["jump"] is True
    assert first["reading"] == "aws"
    assert first["actions"] == ["shoot", "scope"]
    assert second["seq"] == 9
    assert second["jump"] is False
    assert second["actions"] == ["scope"]


def test_chat_and_commands_hide_wire_messages() -> None:
    connection = FakeConnection()
    controls = Controls(connection)  # type: ignore[arg-type]

    asyncio.run(controls.chat("hello"))
    asyncio.run(controls.command("sniper"))

    assert connection.sent == [
        {"t": "chat", "text": "hello"},
        {"t": "chat", "text": "/sniper"},
    ]
