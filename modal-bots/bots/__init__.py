"""Modal bots to make kathir world peak.

Each bot runs on one of the bots app's workers (``app.py``), which decides what it's given. A dumb
bot gets a room, a name, how long to stay and where to stand; a combat bot also gets the world map
(``common.world``) and the parts of player names it goes after, empty for every person. The
worker a chat-called bot runs on is its ``worker`` in ``packages/shared/src/sim/bots.ts``.
"""

from collections.abc import Awaitable
from typing import Any, Protocol, TypeVar

from common import Vec3, WorldMap

from .circle_bot import run_circle_bot
from .observer_bot import run_observer_bot
from .sniper_bot import run_sniper_bot
from .stalker_bot import run_stalker_bot


class DumbBotInvocation(Protocol):
    def __call__(
        self,
        room: str,
        name: str,
        seconds: float,
        *,
        lobby_url: str | None,
        direct_ws_url: str | None = None,
        spawn: Vec3 | None = None,
        avatar: str | None = None,
    ) -> Awaitable[dict[str, Any]]: ...


class CombatBotInvocation(Protocol):
    def __call__(
        self,
        room: str,
        name: str,
        seconds: float,
        *,
        world: WorldMap,
        targets: tuple[str, ...] = (),
        lobby_url: str | None,
        direct_ws_url: str | None = None,
        spawn: Vec3 | None = None,
        avatar: str | None = None,
    ) -> Awaitable[dict[str, Any]]: ...


DUMB_BOTS: dict[str, DumbBotInvocation] = {
    "circle": run_circle_bot,
    "observer": run_observer_bot,
    "stalker": run_stalker_bot,
}

COMBAT_BOTS: dict[str, CombatBotInvocation] = {
    "sniper": run_sniper_bot,
}


def get_dumb_bot(name: str) -> DumbBotInvocation:
    return _get(DUMB_BOTS, name, "dumb")


def get_combat_bot(name: str) -> CombatBotInvocation:
    return _get(COMBAT_BOTS, name, "combat")


T = TypeVar("T")


def _get(registry: dict[str, T], name: str, kind: str) -> T:
    try:
        return registry[name]
    except KeyError:
        available = ", ".join(sorted(registry))
        raise ValueError(f"unknown {kind} bot {name!r}; choose one of: {available}") from None
