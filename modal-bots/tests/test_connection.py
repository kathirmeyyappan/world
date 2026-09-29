from __future__ import annotations

import asyncio
import json

import httpx
import pytest

import common.connection as connection
from common import RoomConnectionError
from tests.helpers import welcome


class FakeWebSocket:
    def __init__(self, payload: str | None):
        self.payload = payload
        self.close_code: int | None = None
        self.close_reason: str | None = None

    async def recv(self) -> str:
        if self.payload is None:
            await asyncio.Future()
        return self.payload

    async def close(self, code: int = 1000, reason: str = "") -> None:
        self.close_code, self.close_reason = code, reason


def test_lobby_ticket_is_small_and_redacted() -> None:
    async def scenario():
        def handler(request: httpx.Request) -> httpx.Response:
            assert request.url.path == "/join/test-room"
            return httpx.Response(
                302,
                headers={"location": ("https://room.example.test:8443/?modal_session_token=secret&room=test-room")},
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await connection._request_ticket(
                "https://lobby.example.test",
                "test-room",
                "observer name",
                timeout=1,
                client=client,
            )

    ticket = asyncio.run(scenario())
    assert ticket.url == ("wss://room.example.test:8443/ws?room=test-room&name=observer+name&bot=1")
    assert ticket.token == "secret"
    assert "secret" not in repr(ticket)


def test_lobby_failure_is_clear() -> None:
    async def scenario() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _request: httpx.Response(400))) as client:
            await connection._request_ticket(
                "https://lobby.example.test",
                "bad-room",
                "observer",
                timeout=1,
                client=client,
            )

    with pytest.raises(RoomConnectionError, match="HTTP 400"):
        asyncio.run(scenario())


def test_connection_requires_welcome() -> None:
    socket = FakeWebSocket('{"t":"snap","tick":1,"players":[],"cubes":[]}')
    with pytest.raises(RoomConnectionError, match="not 'welcome'"):
        asyncio.run(
            connection._welcome(
                socket,  # type: ignore[arg-type]
                "room",
                "observer",
                "direct",
                1,
            )
        )
    assert socket.close_code == 1002


def test_connection_accepts_welcome_and_times_out_cleanly() -> None:
    socket = FakeWebSocket(json.dumps(welcome()))
    client = asyncio.run(
        connection._welcome(
            socket,  # type: ignore[arg-type]
            "room",
            "observer",
            "direct",
            1,
        )
    )
    assert client.id == "p1"

    timeout_socket = FakeWebSocket(None)
    with pytest.raises(RoomConnectionError, match="timed out"):
        asyncio.run(
            connection._welcome(
                timeout_socket,  # type: ignore[arg-type]
                "room",
                "observer",
                "direct",
                0.01,
            )
        )
    assert timeout_socket.close_code == 1000
