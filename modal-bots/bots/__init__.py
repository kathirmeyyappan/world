"""Modal bots to make kathir world peak."""

from collections.abc import Awaitable, Callable
from typing import Any

from .observer_bot import run_observer_bot

BotInvocation = Callable[..., Awaitable[dict[str, Any]]]

BOT_INVOCATIONS: dict[str, BotInvocation] = {
    "observer": run_observer_bot,
}


def get_bot_invocation(name: str) -> BotInvocation:
    try:
        return BOT_INVOCATIONS[name]
    except KeyError:
        available = ", ".join(sorted(BOT_INVOCATIONS))
        raise ValueError(f"unknown bot {name!r}; choose one of: {available}") from None
