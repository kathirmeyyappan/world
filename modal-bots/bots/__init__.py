"""Modal bots to make kathir world peak."""

from collections.abc import Awaitable
from typing import Any, Protocol

from .circle_bot import run_circle_bot
from .observer_bot import run_observer_bot

class BotInvocation(Protocol):
    def __call__(
        self,
        room: str,
        name: str,
        seconds: float,
        *,
        lobby_url: str | None,
        direct_ws_url: str | None = None,
    ) -> Awaitable[dict[str, Any]]: ...

BOT_INVOCATIONS: dict[str, BotInvocation] = {
    "circle": run_circle_bot,
    "observer": run_observer_bot,
}


def get_bot_invocation(name: str) -> BotInvocation:
    try:
        return BOT_INVOCATIONS[name]
    except KeyError:
        available = ", ".join(sorted(BOT_INVOCATIONS))
        raise ValueError(f"unknown bot {name!r}; choose one of: {available}") from None
