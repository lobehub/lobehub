from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass, field
from email.parser import BytesParser
from email.policy import HTTP
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Dict, Iterator, List, Optional, Tuple, Union
from urllib.parse import parse_qs, urlsplit

import pytest

from lobehub import _base_client

API_KEY = "sk-lh-test0000000000ab"


@dataclass
class Recorded:
    method: str
    path: str
    query: Dict[str, List[str]]
    headers: Dict[str, str]
    body: bytes

    def json(self) -> Any:
        return json.loads(self.body)

    def multipart(self) -> Tuple[Dict[str, str], List[Tuple[str, str, str, bytes]]]:
        """(form fields, [(field, filename, content type, bytes)]) of a multipart body."""
        raw = f"Content-Type: {self.headers['content-type']}\r\n\r\n".encode() + self.body
        message = BytesParser(policy=HTTP).parsebytes(raw)
        fields: Dict[str, str] = {}
        files: List[Tuple[str, str, str, bytes]] = []
        for part in message.iter_parts():
            name = part.get_param("name", header="content-disposition")
            filename = part.get_filename()
            payload = part.get_payload(decode=True) or b""
            if filename is None:
                fields[name] = payload.decode()
            else:
                files.append((name, filename, part.get_content_type(), payload))
        return fields, files


@dataclass
class Reply:
    status: int = 200
    body: Union[bytes, str, Dict[str, Any], List[Any], None] = None
    headers: Dict[str, str] = field(default_factory=dict)
    #: Sent one by one with a flush in between (a streaming body); overrides `body`.
    chunks: Optional[List[bytes]] = None
    chunk_delay: float = 0.0
    #: Wait this long before answering (to trigger client timeouts).
    delay: float = 0.0


Handler = Callable[[Recorded], Reply]


class MockServer:
    """A real local HTTP server: replies are queued per test, requests are recorded."""

    def __init__(self) -> None:
        self.requests: List[Recorded] = []
        self._replies: List[Union[Reply, Handler]] = []
        self.default: Optional[Union[Reply, Handler]] = None
        self.closed_early = threading.Event()
        server = self

        class RequestHandler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args: Any) -> None:
                pass

            def _handle(self) -> None:
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length) if length else b""
                parts = urlsplit(self.path)
                recorded = Recorded(
                    method=self.command,
                    path=parts.path,
                    query=parse_qs(parts.query),
                    headers={k.lower(): v for k, v in self.headers.items()},
                    body=body,
                )
                server.requests.append(recorded)
                reply = server._next()
                if callable(reply):
                    reply = reply(recorded)
                if reply.delay:
                    time.sleep(reply.delay)
                self._write(reply)

            def _write(self, reply: Reply) -> None:
                self.send_response(reply.status)
                headers = dict(reply.headers)
                if reply.chunks is not None:
                    headers.setdefault("Content-Type", "text/event-stream")
                    headers["Transfer-Encoding"] = "chunked"
                    for key, value in headers.items():
                        self.send_header(key, value)
                    self.end_headers()
                    try:
                        for chunk in reply.chunks:
                            self.wfile.write(f"{len(chunk):x}\r\n".encode() + chunk + b"\r\n")
                            self.wfile.flush()
                            if reply.chunk_delay:
                                time.sleep(reply.chunk_delay)
                        self.wfile.write(b"0\r\n\r\n")
                        self.wfile.flush()
                    except (BrokenPipeError, ConnectionResetError):
                        server.closed_early.set()
                    return

                payload = reply.body
                if isinstance(payload, (dict, list)):
                    payload = json.dumps(payload).encode()
                    headers.setdefault("Content-Type", "application/json")
                elif isinstance(payload, str):
                    payload = payload.encode()
                    headers.setdefault("Content-Type", "text/plain")
                payload = payload or b""
                headers["Content-Length"] = str(len(payload))
                for key, value in headers.items():
                    self.send_header(key, value)
                self.end_headers()
                try:
                    self.wfile.write(payload)
                except (BrokenPipeError, ConnectionResetError):
                    pass

            do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = _handle

        class QuietServer(ThreadingHTTPServer):
            def handle_error(self, request: Any, client_address: Any) -> None:
                # A client that hung up (timeout tests, an abandoned stream) is expected.
                pass

        self._server = QuietServer(("127.0.0.1", 0), RequestHandler)
        self._server.daemon_threads = True
        self.base_url = f"http://127.0.0.1:{self._server.server_address[1]}"
        self._thread = threading.Thread(
            target=self._server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True
        )
        self._thread.start()

    def reply(self, *replies: Union[Reply, Handler]) -> None:
        self._replies.extend(replies)

    def _next(self) -> Union[Reply, Handler]:
        if self._replies:
            return self._replies.pop(0)
        if self.default is not None:
            return self.default
        return Reply(500, {"code": "internal_error", "message": "no reply queued"})

    def close(self) -> None:
        self._server.shutdown()
        self._server.server_close()


@pytest.fixture
def server() -> Iterator[MockServer]:
    mock = MockServer()
    yield mock
    mock.close()


@pytest.fixture
def sleeps(monkeypatch: pytest.MonkeyPatch) -> List[float]:
    """Record retry sleeps instead of waiting them out."""
    recorded: List[float] = []

    async def fake_async_sleep(delay: float) -> None:
        recorded.append(delay)

    monkeypatch.setattr(_base_client, "_sleep", recorded.append)
    monkeypatch.setattr(_base_client, "_asleep", fake_async_sleep)
    return recorded


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def envelope(data: Any) -> Dict[str, Any]:
    return {"data": data, "success": True, "timestamp": "2026-11-18T00:00:00.000Z"}


def api_error(code: str, message: str = "boom", **extra: Any) -> Dict[str, Any]:
    return {
        "code": code,
        "error": message,
        "message": message,
        "requestId": "req_123",
        "success": False,
        "timestamp": "2026-11-18T00:00:00.000Z",
        **extra,
    }
