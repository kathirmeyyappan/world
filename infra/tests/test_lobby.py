"""The lobby's /healthz is the launcher's warm-up ping: it answers at once and boots a Room behind it."""

import asyncio

import httpx

from infra.lobby import build_api


def test_healthz_warms_a_room_without_waiting_for_it():
    started = asyncio.Event()
    release = asyncio.Event()

    async def warm():
        started.set()
        await release.wait()

    async def run():
        api = build_api(warm=warm)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api), base_url="http://lobby") as client:
            res = await client.get("/healthz")
        assert res.status_code == 200 and res.json() == {"ok": True}
        await asyncio.sleep(0)
        assert started.is_set(), "the warm-up runs in the background"
        assert not release.is_set(), "and the response never waited on it"
        release.set()

    asyncio.run(run())
