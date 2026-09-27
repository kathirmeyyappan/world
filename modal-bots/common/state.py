"""Current authoritative state derived from room messages."""

from __future__ import annotations

from dataclasses import replace
from typing import Any

from .protocol import Message, Player, Snapshot, Welcome, player, to_dict


class WorldState:
    def __init__(self, welcome: Welcome, requested_room: str | None = None):
        self.requested_room = requested_room or welcome.room
        self.session_room = welcome.room
        self.self_id = welcome.id
        self.tick = welcome.tick
        self.players = {value.id: value for value in welcome.players}
        self.cubes = {value.id: value for value in welcome.cubes}

    @property
    def me(self) -> Player | None:
        return self.players.get(self.self_id)

    def apply(self, message: Message) -> None:
        if isinstance(message, Snapshot):
            self.tick = message.tick
            self.players = {value.id: value for value in message.players}
            self.cubes = {value.id: value for value in message.cubes}
        elif isinstance(message, Welcome):
            self.__init__(message, self.requested_room)
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
        elif message.t == "kill":
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
