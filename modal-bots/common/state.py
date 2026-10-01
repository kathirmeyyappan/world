"""Current authoritative state derived from room messages."""

from __future__ import annotations

import math
from dataclasses import replace
from typing import Any

from .protocol import Message, Player, Snapshot, Welcome, player, to_dict


class WorldState:
    def __init__(self, welcome: Welcome, requested_room: str | None = None):
        self.requested_room = requested_room or welcome.room
        self._reset(welcome)

    def _reset(self, welcome: Welcome) -> None:
        self.session_room = welcome.room
        self.self_id = welcome.id
        self.tick = welcome.tick
        self.players = {value.id: value for value in welcome.players}
        self.cubes = {value.id: value for value in welcome.cubes}

    @property
    def me(self) -> Player | None:
        return self.players.get(self.self_id)

    def nearest_player(self, *, people_only: bool = False) -> Player | None:
        """The closest living player to this bot in a straight line (someone a floor above isn't
        next to us), leaving out bots when ``people_only``."""
        me = self.me
        if me is None:
            return None
        candidates = (p for p in self.players.values() if p.id != me.id and not p.dead and not (people_only and p.bot))
        return min(
            candidates,
            key=lambda p: math.dist((p.pos.x, p.pos.y, p.pos.z), (me.pos.x, me.pos.y, me.pos.z)),
            default=None,
        )

    def apply(self, message: Message) -> None:
        if isinstance(message, Snapshot):
            self.tick = message.tick
            self.players = {value.id: value for value in message.players}
            self.cubes = {value.id: value for value in message.cubes}
        elif isinstance(message, Welcome):
            self.requested_room = self.requested_room or message.room
            self._reset(message)
        elif message.t == "join":
            joined = player(message.data["p"])
            self.players[joined.id] = joined
        elif message.t == "leave":
            self.players.pop(message.data["id"], None)
        elif message.t == "hit":
            victim = self.players.get(message.data["victim"])
            if victim is not None:
                hearts = message.data["hearts"]
                self.players[victim.id] = replace(
                    victim,
                    hearts=hearts,
                    dead=hearts <= 0,
                )
        elif message.t in ("kill", "fell"):
            victim = self.players.get(message.data["victim"])
            if victim is not None:
                self.players[victim.id] = replace(victim, dead=True)

    def to_dict(self) -> dict[str, Any]:
        return {
            "requested_room": self.requested_room,
            "session_room": self.session_room,
            "self_id": self.self_id,
            "tick": self.tick,
            "players": [to_dict(value) for value in self.players.values()],
            "cubes": [to_dict(value) for value in self.cubes.values()],
        }
