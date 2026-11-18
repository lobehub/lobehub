from __future__ import annotations

import codecs
import json
import re
from dataclasses import dataclass
from types import TracebackType
from typing import (
    TYPE_CHECKING,
    Any,
    AsyncIterator,
    Awaitable,
    Callable,
    Generic,
    Iterable,
    Iterator,
    List,
    Optional,
    Type,
    TypeVar,
    cast,
)

import httpx
from typing_extensions import Self

if TYPE_CHECKING:
    from .generated.types import ResponseObject, ResponseStreamEvent

T = TypeVar("T")

_NEWLINE = re.compile(r"\r\n|\r|\n")


@dataclass(frozen=True)
class ServerSentEvent:
    """One `text/event-stream` message."""

    data: str
    event: Optional[str] = None
    id: Optional[str] = None

    def json(self) -> Any:
        return json.loads(self.data)


class SSEDecoder:
    """
    Incremental `text/event-stream` parser (WHATWG framing: `field: value`
    lines, a blank line ends a message, `:` lines are comments).
    """

    def __init__(self) -> None:
        self._decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        self._buffer = ""
        self._data: List[str] = []
        self._event: Optional[str] = None
        self._id: Optional[str] = None

    def feed(self, chunk: bytes) -> List[ServerSentEvent]:
        self._buffer += self._decoder.decode(chunk)
        return self._drain(final=False)

    def flush(self) -> List[ServerSentEvent]:
        """End of body: be lenient with a stream missing its final blank line."""
        self._buffer += self._decoder.decode(b"", final=True)
        events = self._drain(final=True)
        if self._buffer:
            self._line(self._buffer)
            self._buffer = ""
        message = self._line("")
        return [*events, message] if message else events

    def _drain(self, final: bool) -> List[ServerSentEvent]:
        events: List[ServerSentEvent] = []
        while True:
            match = _NEWLINE.search(self._buffer)
            if not match:
                return events
            # A lone trailing `\r` may be the first half of `\r\n`: wait for more.
            if not final and match.group() == "\r" and match.end() == len(self._buffer):
                return events
            line, self._buffer = self._buffer[: match.start()], self._buffer[match.end() :]
            message = self._line(line)
            if message:
                events.append(message)

    def _line(self, line: str) -> Optional[ServerSentEvent]:
        if line == "":
            message = ServerSentEvent("\n".join(self._data), self._event, self._id) if self._data else None
            self._data, self._event = [], None
            return message
        if line.startswith(":"):
            return None
        field, _, value = line.partition(":")
        value = value[1:] if value.startswith(" ") else value
        if field == "data":
            self._data.append(value)
        elif field == "event":
            self._event = value
        elif field == "id":
            self._id = value
        return None


def iter_sse(chunks: Iterable[bytes]) -> Iterator[ServerSentEvent]:
    decoder = SSEDecoder()
    for chunk in chunks:
        yield from decoder.feed(chunk)
    yield from decoder.flush()


async def aiter_sse(chunks: AsyncIterator[bytes]) -> AsyncIterator[ServerSentEvent]:
    decoder = SSEDecoder()
    async for chunk in chunks:
        for event in decoder.feed(chunk):
            yield event
    for event in decoder.flush():
        yield event


class Stream(Generic[T]):
    """
    A server-sent event stream. The request is sent when iteration starts;
    iterate it once. Leaving the loop early (or `close()`, or the `with`
    block) closes the connection.
    """

    def __init__(self, open: Callable[[], httpx.Response]) -> None:
        self._open = open
        self._consumed = False
        self.response: Optional[httpx.Response] = None

    def _transform(self, event: ServerSentEvent) -> Optional[T]:
        return cast(T, event)

    def __iter__(self) -> Iterator[T]:
        if self._consumed:
            raise RuntimeError("A stream can only be iterated once")
        self._consumed = True
        self.response = self._open()
        try:
            for message in iter_sse(self.response.iter_bytes()):
                item = self._transform(message)
                if item is not None:
                    yield item
        finally:
            # Breaking out early must not leave the connection (and the run's
            # server-side subscription) open.
            self.response.close()

    def close(self) -> None:
        if self.response is not None:
            self.response.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc: Optional[BaseException],
        tb: Optional[TracebackType],
    ) -> None:
        self.close()


class AsyncStream(Generic[T]):
    """The async counterpart of `Stream`: `async for event in stream`."""

    def __init__(self, open: Callable[[], Awaitable[httpx.Response]]) -> None:
        self._open = open
        self._consumed = False
        self.response: Optional[httpx.Response] = None

    def _transform(self, event: ServerSentEvent) -> Optional[T]:
        return cast(T, event)

    async def __aiter__(self) -> AsyncIterator[T]:
        if self._consumed:
            raise RuntimeError("A stream can only be iterated once")
        self._consumed = True
        self.response = await self._open()
        try:
            async for message in aiter_sse(self.response.aiter_bytes()):
                item = self._transform(message)
                if item is not None:
                    yield item
        finally:
            await self.response.aclose()

    async def close(self) -> None:
        if self.response is not None:
            await self.response.aclose()

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc: Optional[BaseException],
        tb: Optional[TracebackType],
    ) -> None:
        await self.close()


TERMINAL_EVENTS = {"response.completed", "response.failed", "response.incomplete"}


class _ResponseEvents:
    _final: Optional[ResponseObject] = None

    def _transform(self, event: ServerSentEvent) -> Optional[ResponseStreamEvent]:
        if not event.data or event.data == "[DONE]":
            return None
        parsed = cast("ResponseStreamEvent", json.loads(event.data))
        if parsed.get("type") in TERMINAL_EVENTS and "response" in parsed:
            self._final = cast("ResponseObject", parsed["response"])  # type: ignore[typeddict-item]
        return parsed

    def _final_or_raise(self) -> ResponseObject:
        if self._final is None:
            raise RuntimeError("The stream ended without a final response event")
        return self._final


class ResponseStream(_ResponseEvents, Stream["ResponseStreamEvent"]):
    """
    `responses.stream()` result: iterate it for typed OpenResponses events, or
    call `final_response()` for the response object the last event carries.
    """

    def final_response(self) -> ResponseObject:
        """Drain the stream and return the final response object."""
        if not self._consumed:
            for _ in self:
                pass
        return self._final_or_raise()


class AsyncResponseStream(_ResponseEvents, AsyncStream["ResponseStreamEvent"]):
    """The async counterpart of `ResponseStream`."""

    async def final_response(self) -> ResponseObject:
        if not self._consumed:
            async for _ in self:
                pass
        return self._final_or_raise()
