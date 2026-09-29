"""The lobby's /healthz is the launcher's warm-up ping: it answers at once and boots a Room behind it."""

import asyncio
from typing import Any

import httpx
import pytest

from infra.lobby import build_api


def test_healthz_warms_a_room_without_waiting_for_it() -> None:
    started = asyncio.Event()
    release = asyncio.Event()

    async def warm() -> None:
        started.set()
        await release.wait()

    async def run() -> None:
        api = build_api(warm=warm)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api), base_url="http://lobby") as client:
            res = await client.get("/healthz")
        assert res.status_code == 200 and res.json() == {"ok": True}
        await asyncio.sleep(0)
        assert started.is_set(), "the warm-up runs in the background"
        assert not release.is_set(), "and the response never waited on it"
        release.set()

    asyncio.run(run())


def test_join_never_starts_a_room_for_a_bot(monkeypatch: pytest.MonkeyPatch) -> None:
    """A person joining a room with no live session gets a fresh one; a bot gets turned away."""
    import infra.lobby as lobby

    started: list[str] = []

    class Aio:
        def __init__(self, value: str) -> None:
            self.value = value

        async def aio(self, *a: Any, **k: Any) -> str:
            return self.value

    class Server:
        get_url = Aio("https://room.test")

    async def live_session(room_id: str, room_url: str) -> None:
        return None

    async def start_session(room_id: str) -> dict[str, str]:
        started.append(room_id)
        return {"session_id": "sd-1", "token": "tok"}

    monkeypatch.setattr(lobby, "room_server", lambda: Server())
    monkeypatch.setattr(lobby, "live_session", live_session)
    monkeypatch.setattr(lobby, "start_session", start_session)
    monkeypatch.setattr(lobby, "lobby", type("Lobby", (), {"get_web_url": Aio("https://lobby.test")})())

    async def run() -> None:
        api = lobby.build_api(warm=lambda: asyncio.sleep(0))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api), base_url="http://lobby") as client:
            bot = await client.get("/join/late-night", params={"name": "circle-bot", "bot": "1"})
            assert bot.status_code == 409 and bot.json() == {"detail": "no one here"}
            assert started == []
            person = await client.get("/join/late-night", params={"name": "kathir"})
            assert person.status_code == 302 and "modal_session_token=tok" in person.headers["location"]
            assert started == ["late-night"]

    asyncio.run(run())
