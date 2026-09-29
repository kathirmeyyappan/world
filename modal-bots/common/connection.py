"""One intuitive connection API for local and Modal-hosted rooms."""

from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass
from typing import Any, AsyncIterator, Mapping
from urllib.parse import urlencode, urlsplit, urlunsplit

import httpx
from websockets.asyncio.client import ClientConnection, connect as open_websocket
from websockets.exceptions import ConnectionClosed, InvalidHandshake, InvalidURI

from .protocol import Event, Message, Snapshot, Welcome, decode

_ROOM_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,23}$")


class RoomConnectionError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True, repr=False)
class _Ticket:
    url: str
    token: str

    def __repr__(self) -> str:
        return "_Ticket(url=<room websocket>, token=<redacted>)"


@dataclass(slots=True)
class Connection:
    room: str
    name: str
    welcome: Welcome
    transport: str
    _websocket: ClientConnection
    close_code: int | None = None
    close_reason: str = ""
    view_tick: int | None = None  # newest snapshot tick; input frames send it as `view`

    @property
    def id(self) -> str:
        return self.welcome.id

    async def receive(self) -> Message:
        try:
            message = decode(await self._websocket.recv())
        except ConnectionClosed as exc:
            self.close_code, self.close_reason = exc.code, exc.reason
            raise RoomConnectionError(
                f"room closed ({exc.code}): {exc.reason or 'no reason'}"
            ) from exc
        if isinstance(message, Snapshot):
            self.view_tick = message.tick
        return message

    async def send(self, message: Mapping[str, Any]) -> None:
        try:
            await self._websocket.send(
                json.dumps(message, separators=(",", ":"), allow_nan=False)
            )
        except ConnectionClosed as exc:
            self.close_code, self.close_reason = exc.code, exc.reason
            raise RoomConnectionError(
                f"room closed ({exc.code}): {exc.reason or 'no reason'}"
            ) from exc

    async def close(self, reason: str = "client complete") -> None:
        await self._websocket.close(code=1000, reason=reason)
        await self._websocket.wait_closed()
        self.close_code = self._websocket.close_code
        self.close_reason = self._websocket.close_reason or ""

    def __aiter__(self) -> AsyncIterator[Message]:
        return self

    async def __anext__(self) -> Message:
        try:
            return await self.receive()
        except RoomConnectionError:
            raise StopAsyncIteration from None

    async def __aenter__(self) -> Connection:
        return self

    async def __aexit__(self, *_args: object) -> None:
        await self.close()


async def connect(
    lobby_url: str | None,
    room: str,
    name: str = "observer",
    *,
    direct_url: str | None = None,
    timeout: float = 10,
    bot: bool = True,
) -> Connection:
    """Join a room and return only after its initial ``welcome``.

    Production bots pass ``lobby_url``. Tests and local tools may instead pass
    ``direct_url="ws://localhost:8787/ws"``. A bot can't join a room with no people in it, so
    tests seat one first with ``bot=False``; production bots never do.
    """

    room = room.strip().lower()
    if not _ROOM_ID.fullmatch(room):
        raise RoomConnectionError(
            "room must be 1-24 lowercase letters, digits, or dashes"
        )

    if direct_url:
        websocket = await _dial(_websocket_url(direct_url, room, name, bot), {}, timeout)
        return await _welcome(websocket, room, name, "direct", timeout)
    if not lobby_url:
        raise RoomConnectionError("lobby_url is required")

    last_error: RoomConnectionError | None = None
    for _attempt in range(2):
        ticket = await _request_ticket(lobby_url, room, name, bot, timeout=timeout)
        try:
            websocket = await _dial(
                ticket.url,
                {"Modal-Authorization": f"Bearer {ticket.token}"},
                timeout,
            )
        except _UpgradeError as exc:
            if exc.status in {401, 403}:
                last_error = RoomConnectionError(
                    "Modal rejected the room session; admission was retried"
                )
                continue
            raise RoomConnectionError(str(exc)) from None
        return await _welcome(websocket, room, name, "modal-header", timeout)

    raise last_error or RoomConnectionError("could not authenticate the room session")


async def _request_ticket(
    lobby_url: str,
    room: str,
    name: str,
    bot: bool = True,
    *,
    timeout: float,
    client: httpx.AsyncClient | None = None,
) -> _Ticket:
    lobby_url = _http_url(lobby_url, "lobby").rstrip("/")
    own_client = client is None
    client = client or httpx.AsyncClient(timeout=timeout, follow_redirects=False)
    try:
        try:
            response = await client.get(
                f"{lobby_url}/join/{room}",
                params={"name": name, "bot": "1"} if bot else {"name": name},
                follow_redirects=False,
            )
        except httpx.HTTPError:
            raise RoomConnectionError("could not reach the lobby") from None
    finally:
        if own_client:
            await client.aclose()

    if response.status_code != 302:
        raise RoomConnectionError(
            f"lobby rejected room admission with HTTP {response.status_code}"
        )
    location = response.headers.get("location")
    if not location:
        raise RoomConnectionError("lobby admission had no Location header")

    try:
        redirect = httpx.URL(location)
        token = redirect.params["modal_session_token"]
        parts = urlsplit(str(redirect))
        if parts.scheme not in {"http", "https"} or not parts.netloc or not token:
            raise ValueError
        websocket_base = urlunsplit(
            ("wss" if parts.scheme == "https" else "ws", parts.netloc, "/ws", "", "")
        )
    except (KeyError, TypeError, ValueError):
        # URL parser errors can echo the credential-bearing Location.
        raise RoomConnectionError("lobby returned an invalid room ticket") from None

    return _Ticket(
        url=_websocket_url(websocket_base, room, name),
        token=token,
    )


async def _dial(
    url: str,
    headers: Mapping[str, str],
    timeout: float,
) -> ClientConnection:
    try:
        return await open_websocket(
            url,
            additional_headers=headers,
            open_timeout=timeout,
            close_timeout=5,
            max_size=2 * 1024 * 1024,
            compression=None,
            user_agent_header="world-modal-bot/0.1",
        )
    except InvalidHandshake as exc:
        response = getattr(exc, "response", None)
        status = getattr(response, "status_code", None)
        raise _UpgradeError(
            "room WebSocket upgrade failed"
            + (f" with HTTP {status}" if isinstance(status, int) else ""),
            status if isinstance(status, int) else None,
        ) from None
    except (InvalidURI, OSError, TimeoutError) as exc:
        raise RoomConnectionError("could not reach the room WebSocket") from exc


async def _welcome(
    websocket: ClientConnection,
    room: str,
    name: str,
    transport: str,
    timeout: float,
) -> Connection:
    try:
        message = decode(await asyncio.wait_for(websocket.recv(), timeout))
    except TimeoutError:
        await websocket.close(code=1000, reason="welcome timeout")
        raise RoomConnectionError("timed out waiting for room welcome") from None
    except Exception:
        await websocket.close(code=1002, reason="invalid welcome")
        raise

    if isinstance(message, Event) and message.t == "error":
        await websocket.close(code=1008, reason="join rejected")
        raise RoomConnectionError(
            f"room rejected join: {message.data.get('message', 'unknown error')}"
        )
    if not isinstance(message, Welcome):
        await websocket.close(code=1002, reason="welcome required")
        raise RoomConnectionError("first room message was not 'welcome'")
    return Connection(room, name, message, transport, websocket)


def _websocket_url(base: str, room: str, name: str, bot: bool = True) -> str:
    """The room WebSocket URL. ``bot=1`` declares this player a bot to the server and everyone
    in the room; the browser client never sends it."""
    parts = urlsplit(base)
    if parts.scheme not in {"ws", "wss"} or not parts.netloc:
        raise RoomConnectionError("room WebSocket URL must be absolute ws:// or wss://")
    query = urlencode({"room": room, "name": name, "bot": "1"} if bot else {"room": room, "name": name})
    return urlunsplit((parts.scheme, parts.netloc, "/ws", query, ""))


def _http_url(value: str, label: str) -> str:
    parts = urlsplit(value)
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        raise RoomConnectionError(f"{label} URL must be absolute HTTP(S)")
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


class _UpgradeError(RuntimeError):
    def __init__(self, message: str, status: int | None):
        super().__init__(message)
        self.status = status
