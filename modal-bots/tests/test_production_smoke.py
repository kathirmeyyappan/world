from __future__ import annotations

import asyncio
import os

import pytest

from bots.observer_bot import run_observer_bot


def test_production_modal_join_flow() -> None:
    """Opt-in because this starts or joins a real Modal room session."""

    if os.environ.get("RUN_MODAL_BOT_SMOKE") != "1":
        pytest.skip("set RUN_MODAL_BOT_SMOKE=1 to exercise the deployed Modal flow")
    lobby_url = os.environ.get("WORLD_LOBBY_URL")
    if not lobby_url:
        pytest.fail("WORLD_LOBBY_URL is required for the production smoke test")

    report = asyncio.run(
        run_observer_bot(
            room=os.environ.get("WORLD_SMOKE_ROOM", "bot-smoke"),
            name="observer-smoke",
            seconds=0.5,
            lobby_url=lobby_url,
        )
    )

    assert report["completed"]
    assert report["transport"] == "modal-header"
    assert report["snapshots"] > 0
    assert report["last_tick"] > report["first_tick"]
