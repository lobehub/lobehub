from __future__ import annotations

import json
from typing import Any, Dict, Optional, Type

import httpx

from ._constants import REQUEST_ID_HEADER


class LobeHubError(Exception):
    """Base class of every error the SDK raises."""


class APIError(LobeHubError):
    """
    An error answer from the API (any non-2xx status).

    It carries the fields of the `ApiError` body (`code`, `message`, `details`,
    `request_id`, …). The OpenResponses route (`POST /api/v1/responses`) answers
    `{"error": {"type", "message", "code"}}`; its `code` / `type` land in `code`.
    Catch a subclass (`NotFoundError`, `RateLimitError`, …) or branch on `code`,
    never on `message`.
    """

    status_code: int
    #: Stable machine-readable code (see `ApiErrorCode` in `lobehub.types`), or `http_<status>`.
    code: str
    message: str
    #: Validation failures list `{"path", "message"}` per field; other routes add their own detail.
    details: Any
    #: Quote it when reporting an issue; also sent as the `X-Request-Id` header.
    request_id: Optional[str]
    timestamp: Optional[str]
    #: The parsed (or raw text) response body.
    body: Any
    response: httpx.Response

    def __init__(self, response: httpx.Response, body: Any) -> None:
        record: Dict[str, Any] = body if isinstance(body, dict) else {}
        nested: Dict[str, Any] = record["error"] if isinstance(record.get("error"), dict) else {}
        message = (
            _text(record.get("message"))
            or _text(nested.get("message"))
            or (body if isinstance(body, str) and body else None)
            or f"Request failed with status {response.status_code}"
        )
        super().__init__(message)
        self.message = message
        self.status_code = response.status_code
        self.response = response
        self.body = body
        self.code = (
            _text(record.get("code"))
            or _text(nested.get("code"))
            or _text(nested.get("type"))
            or f"http_{response.status_code}"
        )
        self.details = record.get("details")
        self.request_id = _text(record.get("requestId")) or response.headers.get(REQUEST_ID_HEADER)
        self.timestamp = _text(record.get("timestamp"))

    @property
    def headers(self) -> httpx.Headers:
        return self.response.headers

    def __str__(self) -> str:
        suffix = f" (request id {self.request_id})" if self.request_id else ""
        return f"{self.status_code} {self.code}: {self.message}{suffix}"


class BadRequestError(APIError):
    """400: the request was malformed or failed validation (`code` `validation_error`)."""


class AuthenticationError(APIError):
    """401: missing, unknown, expired or revoked credentials."""


class PermissionDeniedError(APIError):
    """403: the key lacks a scope (`insufficient_scope`) or the workspace (`workspace_mismatch`)."""


class NotFoundError(APIError):
    """404: the resource does not exist or is not visible to the caller."""


class ConflictError(APIError):
    """409: the request conflicts with the current state, e.g. `idempotency_conflict`."""


class UnprocessableEntityError(APIError):
    """422: well-formed but not processable, e.g. an `Idempotency-Key` reused for another request."""


class RateLimitError(APIError):
    """429: slow down; `retry_after` says for how long (seconds), when the server told."""

    @property
    def retry_after(self) -> Optional[float]:
        value = self.headers.get("Retry-After")
        try:
            return float(value) if value is not None else None
        except ValueError:
            return None


class InternalServerError(APIError):
    """5xx: the server failed; safe to retry idempotent requests."""


class APIConnectionError(LobeHubError):
    """The request never got an HTTP answer: DNS, TLS, connection reset, …"""

    def __init__(self, message: str = "Connection error", *, request: Optional[httpx.Request] = None) -> None:
        super().__init__(message)
        self.request = request


class APITimeoutError(APIConnectionError):
    """No answer arrived within `timeout` seconds."""

    def __init__(self, timeout: Optional[float], *, request: Optional[httpx.Request] = None) -> None:
        super().__init__(f"Request timed out after {timeout}s", request=request)
        self.timeout = timeout


_STATUS_ERRORS: Dict[int, Type[APIError]] = {
    400: BadRequestError,
    401: AuthenticationError,
    403: PermissionDeniedError,
    404: NotFoundError,
    409: ConflictError,
    422: UnprocessableEntityError,
    429: RateLimitError,
}


def _text(value: Any) -> Optional[str]:
    return value if isinstance(value, str) and value else None


def parse_error_body(response: httpx.Response) -> Any:
    """The JSON body of an error answer, or its text when it is not JSON."""
    try:
        return response.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        return response.text


def make_status_error(response: httpx.Response) -> APIError:
    """The `APIError` subclass for an already-read error `response`."""
    cls = _STATUS_ERRORS.get(response.status_code)
    if cls is None:
        cls = InternalServerError if response.status_code >= 500 else APIError
    return cls(response, parse_error_body(response))
