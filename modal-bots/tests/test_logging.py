from __future__ import annotations

import json

import pytest

from common import log_death, log_kill, log_message


def test_bot_logs_are_structured_json(capsys: pytest.CaptureFixture[str]) -> None:
    log_kill("hunter", "alice", item="sniper", headshot=True)
    log_death("hunter", "bob", item="gun")
    log_message("hunter", "target acquired", distance=12.5)

    records = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert records == [
        {
            "event": "kill",
            "bot": "hunter",
            "victim": "alice",
            "item": "sniper",
            "headshot": True,
        },
        {
            "event": "death",
            "bot": "hunter",
            "killer": "bob",
            "item": "gun",
        },
        {
            "event": "message",
            "bot": "hunter",
            "message": "target acquired",
            "distance": 12.5,
        },
    ]
