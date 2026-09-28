"""Structured bot events written to Modal function logs."""

from __future__ import annotations

import json
from typing import Any


def log_kill(bot: str, victim: str, **details: Any) -> None:
    _log("kill", bot, victim=victim, **details)


def log_death(bot: str, killer: str | None = None, **details: Any) -> None:
    _log("death", bot, killer=killer, **details)


def log_message(bot: str, message: str, **details: Any) -> None:
    _log("message", bot, message=message, **details)


def _log(event: str, bot: str, **details: Any) -> None:
    record = {"event": event, "bot": bot}
    record.update(details)
    print(json.dumps(record, default=str, ensure_ascii=False), flush=True)
