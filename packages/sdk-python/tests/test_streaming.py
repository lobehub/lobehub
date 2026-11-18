from __future__ import annotations

import json
from typing import Any, AsyncIterator, Dict, List

import httpx
import pytest

from lobehub import (
    APIConnectionError,
    APITimeoutError,
    AsyncLobeHub,
    LobeHub,
    PermissionDeniedError,
    ServerSentEvent,
)
from lobehub._streaming import SSEDecoder, iter_sse

from .conftest import API_KEY, MockServer, Reply, api_error

FINAL = {"id": "resp_1", "object": "response", "status": "completed", "output": [], "model": "agt_1"}


def sse(event: Dict[str, Any]) -> bytes:
    return f"event: {event['type']}\ndata: {json.dumps(event)}\n\n".encode()


def response_events() -> List[bytes]:
    return [
        sse(
            {"type": "response.created", "sequence_number": 0, "response": {**FINAL, "status": "in_progress"}}
        ),
        b": keep-alive\n\n",
        sse({"type": "response.output_text.delta", "sequence_number": 1, "delta": "Hel"}),
        # One event split across two chunks, mid-way through a UTF-8 character.
        sse({"type": "response.output_text.delta", "sequence_number": 2, "delta": "lo 世界"})[:-12],
        sse({"type": "response.output_text.delta", "sequence_number": 2, "delta": "lo 世界"})[-12:],
        sse({"type": "response.completed", "sequence_number": 3, "response": FINAL}),
        b"data: [DONE]\n\n",
    ]


def test_sse_decoder_framing() -> None:
    chunks = [
        b"id: 1\r\nevent: a\r\ndata: line1\r\ndata: line2\r\n\r\n",
        b": comment\n\ndata:no-space\r",
        b"\n\r\nevent: b\ndata: x",
    ]
    events = list(iter_sse(chunks))
    assert events == [
        ServerSentEvent(data="line1\nline2", event="a", id="1"),
        ServerSentEvent(data="no-space", event=None, id="1"),
        ServerSentEvent(data="x", event="b", id="1"),
    ]
    assert SSEDecoder().feed(b"event: only\n\n") == []


def test_responses_stream_yields_typed_events_and_the_final_response(server: MockServer) -> None:
    server.reply(Reply(chunks=response_events()))
    client = LobeHub(api_key=API_KEY, base_url=server.base_url, workspace_id="ws_1")

    deltas: List[str] = []
    with client.responses.stream({"model": "agt_1", "input": "hi"}) as stream:
        for event in stream:
            if event["type"] == "response.output_text.delta":
                deltas.append(event["delta"])
        final = stream.final_response()

    assert "".join(deltas) == "Hello 世界"
    assert final == FINAL
    request = server.requests[0]
    assert request.json() == {"model": "agt_1", "input": "hi", "stream": True}
    assert request.headers["accept"] == "text/event-stream"
    assert request.headers["x-workspace-id"] == "ws_1"


def test_final_response_drains_and_the_request_waits_for_iteration(server: MockServer) -> None:
    server.reply(Reply(chunks=response_events()))
    stream = LobeHub(api_key=API_KEY, base_url=server.base_url).responses.stream(
        {"model": "agt_1", "input": "x"}
    )
    assert server.requests == []
    assert stream.final_response()["status"] == "completed"
    with pytest.raises(RuntimeError, match="once"):
        list(stream)


def test_breaking_out_closes_the_connection(server: MockServer) -> None:
    endless = [
        sse({"type": "response.output_text.delta", "sequence_number": i, "delta": "x"}) for i in range(400)
    ]
    server.reply(Reply(chunks=endless, chunk_delay=0.01))
    stream = LobeHub(api_key=API_KEY, base_url=server.base_url).responses.stream(
        {"model": "agt_1", "input": "x"}
    )
    for index, _ in enumerate(stream):
        if index == 2:
            break
    assert stream.response is not None and stream.response.is_closed
    assert server.closed_early.wait(5)


def test_stream_error_status_raises_before_iterating(server: MockServer) -> None:
    server.reply(Reply(403, api_error("insufficient_scope", "Needs model:invoke")))
    stream = LobeHub(api_key=API_KEY, base_url=server.base_url).responses.stream(
        {"model": "agt_1", "input": "x"}
    )
    with pytest.raises(PermissionDeniedError) as caught:
        next(iter(stream))
    assert caught.value.code == "insufficient_scope"


def test_stream_without_a_final_event(server: MockServer) -> None:
    server.reply(
        Reply(chunks=[sse({"type": "response.output_text.delta", "sequence_number": 0, "delta": "x"})])
    )
    stream = LobeHub(api_key=API_KEY, base_url=server.base_url).responses.stream(
        {"model": "agt_1", "input": "x"}
    )
    with pytest.raises(RuntimeError, match="final response"):
        stream.final_response()


def test_create_refuses_stream_true(server: MockServer) -> None:
    client = LobeHub(api_key=API_KEY, base_url=server.base_url)
    with pytest.raises(TypeError, match="responses.stream"):
        client.responses.create({"model": "agt_1", "input": "x", "stream": True})
    assert server.requests == []


def test_stream_events_for_any_sse_endpoint(server: MockServer) -> None:
    server.reply(
        Reply(chunks=[b'event: run.step\ndata: {"step": 1}\n\n', b'event: run.done\ndata: {"ok": true}\n\n'])
    )
    client = LobeHub(api_key=API_KEY, base_url=server.base_url)
    events = list(client.stream_events("GET", "/api/v1/runs/run_1/events", query={"after": 3}))
    assert [(e.event, e.json()) for e in events] == [("run.step", {"step": 1}), ("run.done", {"ok": True})]
    assert server.requests[0].query == {"after": ["3"]}


@pytest.mark.anyio
async def test_async_responses_stream(server: MockServer) -> None:
    server.reply(Reply(chunks=response_events()))
    async with AsyncLobeHub(api_key=API_KEY, base_url=server.base_url) as client:
        stream = client.responses.stream({"model": "agt_1", "input": "hi"})
        types = [event["type"] async for event in stream]
        final = await stream.final_response()
    assert types[0] == "response.created" and types[-1] == "response.completed"
    assert final == FINAL


@pytest.mark.anyio
async def test_async_stream_events(server: MockServer) -> None:
    server.reply(Reply(chunks=[b"data: 1\n\n", b"data: 2\n\n"]))
    async with AsyncLobeHub(api_key=API_KEY, base_url=server.base_url) as client:
        async with client.stream_events("GET", "/api/v1/runs/run_1/events") as stream:
            data = [event.data async for event in stream]
    assert data == ["1", "2"]


def test_a_stalled_stream_raises_api_timeout_error(server: MockServer) -> None:
    first = sse({"type": "response.output_text.delta", "sequence_number": 0, "delta": "x"})
    server.reply(Reply(chunks=[first, first], chunk_delay=1.0))
    stream = LobeHub(api_key=API_KEY, base_url=server.base_url, timeout=0.3).responses.stream(
        {"model": "agt_1", "input": "x"}
    )
    received = []
    with pytest.raises(APITimeoutError):
        for event in stream:
            received.append(event)
    assert len(received) == 1


@pytest.mark.anyio
async def test_async_stream_dropped_mid_body_raises_api_connection_error() -> None:
    class Dropping(httpx.AsyncByteStream):
        async def __aiter__(self) -> AsyncIterator[bytes]:
            yield b"data: 1\n\n"
            raise httpx.ReadError("connection reset")

    transport = httpx.MockTransport(lambda request: httpx.Response(200, stream=Dropping()))
    client = AsyncLobeHub(api_key=API_KEY, http_client=httpx.AsyncClient(transport=transport))
    data = []
    with pytest.raises(APIConnectionError, match="connection reset"):
        async for event in client.stream_events("GET", "/api/v1/runs/run_1/events"):
            data.append(event.data)
    assert data == ["1"]
