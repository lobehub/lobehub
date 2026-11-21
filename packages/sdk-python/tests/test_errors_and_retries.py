from __future__ import annotations

from typing import List, Type

import httpx
import pytest

from lobehub import (
    APIConnectionError,
    APIError,
    APITimeoutError,
    AsyncLobeHub,
    AuthenticationError,
    BadRequestError,
    ConflictError,
    InternalServerError,
    LobeHub,
    NotFoundError,
    PermissionDeniedError,
    RateLimitError,
    UnprocessableEntityError,
)
from lobehub._base_client import backoff_delay, parse_retry_after

from .conftest import API_KEY, MockServer, Reply, api_error, envelope

PAGE = envelope({"items": [], "hasMore": False, "nextCursor": None, "total": 0})


def make(server: MockServer, **options: object) -> LobeHub:
    return LobeHub(api_key=API_KEY, base_url=server.base_url, **options)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("status", "cls"),
    [
        (400, BadRequestError),
        (401, AuthenticationError),
        (403, PermissionDeniedError),
        (404, NotFoundError),
        (409, ConflictError),
        (422, UnprocessableEntityError),
        (429, RateLimitError),
        (500, InternalServerError),
        (503, InternalServerError),
        (402, APIError),
    ],
)
def test_status_maps_to_a_typed_error(server: MockServer, status: int, cls: Type[APIError]) -> None:
    server.default = Reply(status, api_error("not_found", "Agent not found"))
    with pytest.raises(cls) as caught:
        make(server, max_retries=0).agents.get("agt_missing")
    error = caught.value
    assert type(error) is cls
    assert error.status_code == status
    assert error.code == "not_found"
    assert error.message == "Agent not found"
    assert error.request_id == "req_123"
    assert "Agent not found" in str(error)


def test_validation_details_and_scope_errors(server: MockServer) -> None:
    details = [{"path": "title", "message": "Required"}]
    server.reply(Reply(400, api_error("validation_error", "Invalid body", details=details)))
    server.reply(Reply(403, api_error("insufficient_scope", "Needs agent:write")))
    client = make(server)

    with pytest.raises(BadRequestError) as invalid:
        client.agents.create({})  # type: ignore[typeddict-item]
    with pytest.raises(PermissionDeniedError) as forbidden:
        client.agents.create({"title": "x"})  # type: ignore[typeddict-unknown-key]

    assert invalid.value.details == details
    assert forbidden.value.code == "insufficient_scope"


def test_openresponses_error_shape_and_text_bodies(server: MockServer) -> None:
    server.reply(
        Reply(400, {"error": {"type": "invalid_request_error", "message": "model is required", "code": None}})
    )
    server.reply(Reply(502, "Bad gateway", headers={"X-Request-Id": "req_hdr"}))
    client = make(server, max_retries=0)

    with pytest.raises(BadRequestError) as nested:
        client.responses.create({"model": "", "input": "hi"})
    with pytest.raises(InternalServerError) as text:
        client.users.me()

    assert (nested.value.code, nested.value.message) == ("invalid_request_error", "model is required")
    assert (text.value.code, text.value.message, text.value.request_id) == (
        "http_502",
        "Bad gateway",
        "req_hdr",
    )


def test_retries_idempotent_requests_with_backoff(server: MockServer, sleeps: List[float]) -> None:
    server.reply(Reply(503, api_error("service_unavailable")), Reply(500, api_error("internal_error")))
    server.reply(Reply(body=PAGE))

    page = make(server).agent_groups.list()

    assert page["hasMore"] is False
    assert len(server.requests) == 3
    assert len(sleeps) == 2 and 0.375 <= sleeps[0] <= 0.625 and 0.75 <= sleeps[1] <= 1.25


def test_honors_retry_after_and_gives_up_on_long_waits(server: MockServer, sleeps: List[float]) -> None:
    server.reply(Reply(429, api_error("rate_limited"), headers={"Retry-After": "3"}), Reply(body=PAGE))
    make(server).agent_groups.list()
    assert sleeps == [3.0]

    server.reply(Reply(429, api_error("rate_limited"), headers={"Retry-After": "120"}))
    with pytest.raises(RateLimitError) as caught:
        make(server).agent_groups.list()
    assert caught.value.retry_after == 120
    assert len(server.requests) == 3


def test_stops_after_max_retries(server: MockServer, sleeps: List[float]) -> None:
    server.default = Reply(503, api_error("service_unavailable"))
    with pytest.raises(InternalServerError):
        make(server, max_retries=3).agent_groups.list()
    assert len(server.requests) == 4

    with pytest.raises(InternalServerError):
        make(server).agent_groups.list(max_retries=0)
    assert len(server.requests) == 5


def test_post_is_only_retried_with_an_idempotency_key(server: MockServer, sleeps: List[float]) -> None:
    group = {"id": "grp_1", "name": "G", "sort": None, "createdAt": "", "updatedAt": ""}
    server.reply(Reply(503, api_error("service_unavailable")))
    with pytest.raises(InternalServerError):
        make(server).agent_groups.create({"name": "G"})
    assert len(server.requests) == 1

    server.reply(Reply(503, api_error("service_unavailable")), Reply(201, envelope(group)))
    created = make(server).agent_groups.create({"name": "G"}, idempotency_key="key-1")
    assert created["id"] == "grp_1"
    assert [r.headers.get("idempotency-key") for r in server.requests[1:]] == ["key-1", "key-1"]


def test_keyed_post_waits_out_an_in_flight_conflict_but_not_a_reused_key(
    server: MockServer, sleeps: List[float]
) -> None:
    group = {"id": "grp_1", "name": "G", "sort": None, "createdAt": "", "updatedAt": ""}
    server.reply(Reply(409, api_error("idempotency_conflict")), Reply(201, envelope(group)))
    assert make(server).agent_groups.create({"name": "G"}, idempotency_key="k")["id"] == "grp_1"

    server.reply(Reply(422, api_error("idempotency_conflict")))
    with pytest.raises(UnprocessableEntityError):
        make(server).agent_groups.create({"name": "G"}, idempotency_key="k")

    server.reply(Reply(409, api_error("conflict")))
    with pytest.raises(ConflictError):
        make(server).agent_groups.create({"name": "G"}, idempotency_key="k")
    assert len(server.requests) == 4


def test_timeout_raises_api_timeout_error_after_retries(server: MockServer, sleeps: List[float]) -> None:
    server.default = Reply(body=PAGE, delay=0.5)
    with pytest.raises(APITimeoutError) as caught:
        make(server, timeout=0.1, max_retries=1).agent_groups.list()
    assert caught.value.timeout == 0.1
    assert len(sleeps) == 1


def test_per_call_timeout_overrides_the_client_default(server: MockServer) -> None:
    server.reply(Reply(body=PAGE, delay=0.3))
    assert make(server, timeout=0.05).agent_groups.list(timeout=5, max_retries=0)["total"] == 0


def refuse(request: httpx.Request) -> httpx.Response:
    raise httpx.ConnectError("connection refused", request=request)


def test_connection_failure_raises_api_connection_error(sleeps: List[float]) -> None:
    attempts: List[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        attempts.append(request)
        return refuse(request)

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    client = LobeHub(api_key=API_KEY, http_client=http_client, max_retries=2)
    with pytest.raises(APIConnectionError, match="connection refused") as caught:
        client.users.me()
    assert not isinstance(caught.value, APITimeoutError)
    assert len(attempts) == 3 and len(sleeps) == 2


def test_retry_helpers() -> None:
    assert parse_retry_after("2") == 2.0
    assert parse_retry_after("Wed, 21 Oct 2015 07:28:10 GMT", now=1445412480.0) == 10.0
    assert parse_retry_after("soon") is None
    assert parse_retry_after(None) is None
    assert backoff_delay(0, lambda: 0.5) == 0.5
    assert backoff_delay(10, lambda: 0.5) == 8.0


@pytest.mark.anyio
async def test_async_errors_and_retries(server: MockServer, sleeps: List[float]) -> None:
    server.reply(Reply(503, api_error("service_unavailable")), Reply(body=PAGE))
    server.reply(Reply(404, api_error("not_found", "nope")))
    async with AsyncLobeHub(api_key=API_KEY, base_url=server.base_url) as client:
        assert (await client.agent_groups.list())["total"] == 0
        with pytest.raises(NotFoundError):
            await client.agents.get("agt_x")
    assert len(sleeps) == 1


@pytest.mark.anyio
async def test_async_connection_error(sleeps: List[float]) -> None:
    transport = httpx.MockTransport(refuse)
    client = AsyncLobeHub(api_key=API_KEY, http_client=httpx.AsyncClient(transport=transport), max_retries=1)
    with pytest.raises(APIConnectionError, match="refused"):
        await client.users.me()
    assert len(sleeps) == 1


def test_retry_after_accepts_an_http_date(server: MockServer) -> None:
    server.reply(
        Reply(429, api_error("rate_limited"), headers={"Retry-After": "Wed, 21 Oct 2099 07:28:00 GMT"})
    )
    with pytest.raises(RateLimitError) as caught:
        make(server, max_retries=0).agent_groups.list()
    assert caught.value.retry_after is not None and caught.value.retry_after > 60


class _DroppedBody(httpx.SyncByteStream):
    def __iter__(self):  # type: ignore[no-untyped-def]
        yield b'{"data":'
        raise httpx.ReadTimeout("read timed out")


def test_a_body_read_failure_is_retried_and_raises_an_sdk_error(sleeps: List[float]) -> None:
    attempts: List[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        attempts.append(request)
        return httpx.Response(200, stream=_DroppedBody())

    client = LobeHub(
        api_key=API_KEY, http_client=httpx.Client(transport=httpx.MockTransport(handler)), max_retries=1
    )
    with pytest.raises(APITimeoutError):
        client.users.me()
    assert len(attempts) == 2 and len(sleeps) == 1


@pytest.mark.anyio
async def test_async_body_read_failure_recovers_on_retry(sleeps: List[float]) -> None:
    class Dropping(httpx.AsyncByteStream):
        async def __aiter__(self):  # type: ignore[no-untyped-def]
            yield b'{"data":'
            raise httpx.ReadError("connection reset")

    replies = [httpx.Response(200, stream=Dropping()), httpx.Response(200, json={"data": {"id": "user_1"}})]
    transport = httpx.MockTransport(lambda request: replies.pop(0))
    client = AsyncLobeHub(api_key=API_KEY, http_client=httpx.AsyncClient(transport=transport))
    assert (await client.users.me())["id"] == "user_1"  # type: ignore[typeddict-item]
    assert len(sleeps) == 1
