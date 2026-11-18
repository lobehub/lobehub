from __future__ import annotations

import copy
import inspect
import json as jsonlib
import os
import random
import time
from typing import Any, Awaitable, Callable, Dict, List, Mapping, Optional, TypeVar, Union

import anyio
import httpx

from ._compat import cached_property
from ._constants import (
    DEFAULT_BASE_URL,
    IDEMPOTENCY_KEY_HEADER,
    WORKSPACE_HEADER,
)
from ._errors import (
    LobeHubError,
    connection_error,
    make_status_error,
    parse_retry_after,
)
from ._response import BinaryResponse
from ._uploads import split_multipart
from ._version import __version__

#: An OIDC access token, or a function returning the current one (called before every request).
AccessToken = Union[str, Callable[[], str]]
#: The async client also accepts a coroutine function.
AsyncAccessToken = Union[str, Callable[[], str], Callable[[], Awaitable[str]]]

# Safe to resend as-is: the server applies them at most once by definition.
IDEMPOTENT_METHODS = {"DELETE", "GET", "HEAD", "OPTIONS", "PUT"}
RETRYABLE_STATUSES = {408, 429, 500, 502, 503, 504}

INITIAL_RETRY_DELAY = 0.5
MAX_RETRY_DELAY = 8.0
#: A server asking for a longer pause than this gets its answer returned instead.
MAX_RETRY_AFTER = 60.0

_Self = TypeVar("_Self", bound="BaseClient")
#: Default of `with_options()` arguments: keep the current value.
NOT_GIVEN: Any = object()


def _sleep(seconds: float) -> None:
    time.sleep(seconds)


async def _asleep(seconds: float) -> None:
    await anyio.sleep(seconds)


def backoff_delay(attempt: int, rand: Callable[[], float] = random.random) -> float:
    """Exponential backoff with ±25% jitter: ~0.5s, 1s, 2s, … capped at 8s."""
    delay: float = min(INITIAL_RETRY_DELAY * 2**attempt, MAX_RETRY_DELAY)
    return delay * (0.75 + rand() * 0.5)


def is_retryable_request(request: httpx.Request) -> bool:
    """
    Only resend what cannot double-apply: idempotent methods, or a POST the
    server deduplicates through its `Idempotency-Key` (the server honors the key
    on POST only, so a keyed PATCH is still not safe to resend).
    """
    method = request.method.upper()
    return method in IDEMPOTENT_METHODS or (method == "POST" and IDEMPOTENCY_KEY_HEADER in request.headers)


def should_retry_status(request: httpx.Request, response: httpx.Response) -> bool:
    """
    Whether an (already read) answer is worth another attempt. A keyed POST
    resent while the first attempt still runs gets 409 `idempotency_conflict`;
    waiting and retrying then yields the stored answer. A 422 with that code
    means a different request reused the key, which a retry cannot fix.
    """
    if response.status_code in RETRYABLE_STATUSES:
        return True
    if response.status_code != 409 or IDEMPOTENCY_KEY_HEADER not in request.headers:
        return False
    try:
        body = response.json()
    except (jsonlib.JSONDecodeError, UnicodeDecodeError):
        return False
    return isinstance(body, dict) and body.get("code") == "idempotency_conflict"


def _query_value(value: Any) -> Any:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (list, tuple)):
        return [_query_value(v) for v in value if v is not None]
    return value


class BaseClient:
    """Configuration and request building shared by the sync and async clients."""

    api_key: Optional[str]
    base_url: str
    workspace_id: Optional[str]
    timeout: float
    max_retries: int

    def __init__(
        self,
        *,
        api_key: Optional[str],
        access_token: Any,
        base_url: Optional[str],
        workspace_id: Optional[str],
        timeout: float,
        max_retries: int,
        default_headers: Optional[Mapping[str, str]],
    ) -> None:
        if api_key is None and access_token is None:
            api_key = os.environ.get("LOBEHUB_API_KEY")
        if not api_key and access_token is None:
            raise LobeHubError(
                "The LobeHub client needs an api_key (or the LOBEHUB_API_KEY environment variable) "
                "or an access_token"
            )
        self.api_key = api_key
        self._access_token = access_token
        self.base_url = (base_url or os.environ.get("LOBEHUB_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
        self.workspace_id = workspace_id
        self.timeout = timeout
        self.max_retries = max_retries
        self._default_headers = dict(default_headers or {})

    def _copy(self: _Self, **overrides: Any) -> _Self:
        clone = copy.copy(self)
        if clone.__dict__.get("_client") is self:
            clone.__dict__["_client"] = clone
        # The copy shares the connection pool: closing it must not close the parent's.
        clone.__dict__["_owns_http"] = False
        # Resources cached by `cached_property` hold the old client: drop them.
        for name in dir(type(self)):
            if isinstance(inspect.getattr_static(type(self), name, None), cached_property):
                clone.__dict__.pop(name, None)
        for key, value in overrides.items():
            if value is not NOT_GIVEN:
                setattr(clone, key, value)
        return clone

    def _headers(self, token: Optional[str]) -> Dict[str, str]:
        headers = {
            "Accept": "application/json",
            "User-Agent": f"lobehub-python/{__version__}",
            **self._default_headers,
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if self.workspace_id:
            headers[WORKSPACE_HEADER] = self.workspace_id
        return headers

    def _timeout(self, timeout: Optional[float]) -> Optional[float]:
        value = self.timeout if timeout is None else timeout
        return value if value and value > 0 else None

    def _build_request(
        self,
        client: Union[httpx.Client, httpx.AsyncClient],
        token: Optional[str],
        method: str,
        path: str,
        *,
        query: Optional[Mapping[str, Any]],
        headers: Optional[Mapping[str, Optional[str]]],
        json: Any,
        multipart: Optional[Mapping[str, Any]],
        extra_headers: Optional[Mapping[str, str]],
        extra_query: Optional[Mapping[str, object]],
        extra_body: Optional[Mapping[str, object]],
        timeout: Optional[float],
        accept: Optional[str],
    ) -> httpx.Request:
        merged = self._headers(token)
        # A per-call header (`workspace_id=`, `idempotency_key=`) wins over the client default.
        merged.update({k: v for k, v in (headers or {}).items() if v is not None})
        merged.update(extra_headers or {})
        if accept:
            merged["Accept"] = accept

        params = {
            k: _query_value(v) for k, v in {**(query or {}), **(extra_query or {})}.items() if v is not None
        }
        content: Dict[str, Any] = {}
        if multipart is not None:
            data, files = split_multipart({**multipart, **(extra_body or {})})
            content = {"data": data, "files": files}
        elif extra_body is not None:
            # Fields the spec does not (yet) describe ride along with the typed body.
            content = {"json": {**(json or {}), **extra_body}}
        elif json is not None:
            content = {"json": json}

        url = path if path.startswith(("http://", "https://")) else f"{self.base_url}{path}"
        return client.build_request(
            method,
            url,
            params=params,
            headers=merged,
            timeout=httpx.Timeout(self._timeout(timeout)),
            **content,
        )

    @staticmethod
    def _parse(response: httpx.Response, kind: str) -> Any:
        if kind == "empty" or response.status_code == 204:
            return None
        if kind == "binary":
            return BinaryResponse(response)
        if not response.content:
            return None
        try:
            body = response.json()
        except (jsonlib.JSONDecodeError, UnicodeDecodeError) as error:
            raise LobeHubError(
                f"Expected a JSON answer from {response.request.method} {response.request.url.path}, "
                f"got {response.headers.get('content-type', 'no content type')}"
            ) from error
        if kind == "envelope" and isinstance(body, dict) and "data" in body:
            return body["data"]
        return body

    def _retry_delay(self, attempt: int, response: Optional[httpx.Response]) -> Optional[float]:
        """Seconds to wait before the next attempt, or None to give up and return `response`."""
        if response is not None:
            retry_after = parse_retry_after(response.headers.get("Retry-After"))
            if retry_after is not None:
                return None if retry_after > MAX_RETRY_AFTER else retry_after
        return backoff_delay(attempt)


class SyncAPIClient(BaseClient):
    _http: httpx.Client

    def _token(self) -> Optional[str]:
        if self._access_token is None:
            return self.api_key
        token = self._access_token() if callable(self._access_token) else self._access_token
        return str(token)

    def _send(
        self,
        method: str,
        path: str,
        *,
        query: Optional[Mapping[str, Any]] = None,
        headers: Optional[Mapping[str, Optional[str]]] = None,
        json: Any = None,
        multipart: Optional[Mapping[str, Any]] = None,
        extra_headers: Optional[Mapping[str, str]] = None,
        extra_query: Optional[Mapping[str, object]] = None,
        extra_body: Optional[Mapping[str, object]] = None,
        timeout: Optional[float] = None,
        max_retries: Optional[int] = None,
        stream: bool = False,
        accept: Optional[str] = None,
    ) -> httpx.Response:
        """Send with retries; raise `APIError` for a non-2xx answer. A `stream` answer is left unread."""
        retries_allowed = self.max_retries if max_retries is None else max_retries
        attempt = 0
        while True:
            request = self._build_request(
                self._http,
                self._token(),
                method,
                path,
                query=query,
                headers=headers,
                json=json,
                multipart=multipart,
                extra_headers=extra_headers,
                extra_query=extra_query,
                extra_body=extra_body,
                timeout=timeout,
                accept=accept,
            )
            can_retry = attempt < (max(0, retries_allowed) if is_retryable_request(request) else 0)
            try:
                response = self._http.send(request, stream=True)
            except httpx.TransportError as error:
                failure = connection_error(error, request, self._timeout(timeout))
                if not can_retry:
                    raise failure from error
                _sleep(backoff_delay(attempt))
                attempt += 1
                continue

            if response.is_success:
                if not stream:
                    response.read()
                return response

            response.read()
            response.close()
            if can_retry and should_retry_status(request, response):
                delay = self._retry_delay(attempt, response)
                if delay is not None:
                    _sleep(delay)
                    attempt += 1
                    continue
            raise make_status_error(response)

    def _request(self, method: str, path: str, *, response: str = "json", **kwargs: Any) -> Any:
        return self._parse(self._send(method, path, **kwargs), response)

    def request(
        self,
        method: str,
        path: str,
        *,
        query: Optional[Mapping[str, Any]] = None,
        json: Any = None,
        headers: Optional[Mapping[str, str]] = None,
        timeout: Optional[float] = None,
        max_retries: Optional[int] = None,
    ) -> httpx.Response:
        """
        Call any API path with the client's auth, workspace, timeout and retries,
        and get the raw `httpx.Response` back (non-2xx still raises `APIError`).
        """
        return self._send(
            method,
            path,
            query=query,
            json=json,
            extra_headers=headers,
            timeout=timeout,
            max_retries=max_retries,
        )


class AsyncAPIClient(BaseClient):
    _http: httpx.AsyncClient

    async def _token(self) -> Optional[str]:
        if self._access_token is None:
            return self.api_key
        if not callable(self._access_token):
            return str(self._access_token)
        value = self._access_token()
        return str(await value) if inspect.isawaitable(value) else str(value)

    async def _send(
        self,
        method: str,
        path: str,
        *,
        query: Optional[Mapping[str, Any]] = None,
        headers: Optional[Mapping[str, Optional[str]]] = None,
        json: Any = None,
        multipart: Optional[Mapping[str, Any]] = None,
        extra_headers: Optional[Mapping[str, str]] = None,
        extra_query: Optional[Mapping[str, object]] = None,
        extra_body: Optional[Mapping[str, object]] = None,
        timeout: Optional[float] = None,
        max_retries: Optional[int] = None,
        stream: bool = False,
        accept: Optional[str] = None,
    ) -> httpx.Response:
        retries_allowed = self.max_retries if max_retries is None else max_retries
        attempt = 0
        while True:
            request = self._build_request(
                self._http,
                await self._token(),
                method,
                path,
                query=query,
                headers=headers,
                json=json,
                multipart=multipart,
                extra_headers=extra_headers,
                extra_query=extra_query,
                extra_body=extra_body,
                timeout=timeout,
                accept=accept,
            )
            can_retry = attempt < (max(0, retries_allowed) if is_retryable_request(request) else 0)
            try:
                response = await self._http.send(request, stream=True)
            except httpx.TransportError as error:
                failure = connection_error(error, request, self._timeout(timeout))
                if not can_retry:
                    raise failure from error
                await _asleep(backoff_delay(attempt))
                attempt += 1
                continue

            if response.is_success:
                if not stream:
                    await response.aread()
                return response

            await response.aread()
            await response.aclose()
            if can_retry and should_retry_status(request, response):
                delay = self._retry_delay(attempt, response)
                if delay is not None:
                    await _asleep(delay)
                    attempt += 1
                    continue
            raise make_status_error(response)

    async def _request(self, method: str, path: str, *, response: str = "json", **kwargs: Any) -> Any:
        return self._parse(await self._send(method, path, **kwargs), response)

    async def request(
        self,
        method: str,
        path: str,
        *,
        query: Optional[Mapping[str, Any]] = None,
        json: Any = None,
        headers: Optional[Mapping[str, str]] = None,
        timeout: Optional[float] = None,
        max_retries: Optional[int] = None,
    ) -> httpx.Response:
        """The async counterpart of `LobeHub.request`."""
        return await self._send(
            method,
            path,
            query=query,
            json=json,
            extra_headers=headers,
            timeout=timeout,
            max_retries=max_retries,
        )


__all__: List[str] = [
    "AccessToken",
    "AsyncAccessToken",
    "AsyncAPIClient",
    "BaseClient",
    "SyncAPIClient",
    "backoff_delay",
    "parse_retry_after",
]
