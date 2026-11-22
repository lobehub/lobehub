"""
OIDC sign-in for native and CLI apps: PKCE authorization code flow and token refresh.

    pkce = create_pkce_pair()
    url = create_authorization_url(client_id=..., redirect_uri=..., code_challenge=pkce.challenge, state=state)
    # open `url` in the browser, receive the redirect, then:
    code = parse_authorization_callback(callback_url, state)
    tokens = exchange_authorization_code(client_id=..., code=code, code_verifier=pkce.verifier, redirect_uri=...)

    client = LobeHub(access_token=RefreshingToken(client_id=..., tokens=tokens, on_refresh=save))
"""

from __future__ import annotations

import base64
import hashlib
import secrets
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional
from urllib.parse import parse_qs, urlencode, urlsplit

import anyio
import httpx

from ._constants import DEFAULT_BASE_URL
from ._errors import LobeHubError

#: The audience every `/api/v1` access token is issued for.
LOBEHUB_API_RESOURCE = "urn:lobehub:chat"

#: Scopes a native app needs to call `/api/v1` and keep a refresh token.
DEFAULT_OAUTH_SCOPE = "profile email offline_access"

#: Refresh this many seconds before the access token expires.
REFRESH_MARGIN = 60.0


class OAuthError(LobeHubError):
    """The authorization server refused, e.g. `invalid_grant` (sign in again) or `state_mismatch`."""

    def __init__(self, code: str, message: Optional[str] = None, status: Optional[int] = None) -> None:
        super().__init__(message or code)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class OAuthTokens:
    access_token: str
    #: Epoch seconds.
    expires_at: float
    #: Rotated on every refresh: always persist the latest one.
    refresh_token: Optional[str] = None
    scope: Optional[str] = None
    token_type: str = "Bearer"


@dataclass(frozen=True)
class PkcePair:
    challenge: str
    verifier: str


def _oidc_url(base_url: Optional[str], path: str) -> str:
    return f"{(base_url or DEFAULT_BASE_URL).rstrip('/')}/oidc/{path}"


def _base64_url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def create_pkce_pair() -> PkcePair:
    """A PKCE verifier and its S256 challenge."""
    verifier = _base64_url(secrets.token_bytes(32))
    return PkcePair(challenge=_base64_url(hashlib.sha256(verifier.encode()).digest()), verifier=verifier)


def create_authorization_url(
    *,
    client_id: str,
    redirect_uri: str,
    code_challenge: str,
    state: str,
    scope: Optional[str] = None,
    base_url: Optional[str] = None,
) -> str:
    """The `/oidc/auth` URL to open in the system browser."""
    query = urlencode(
        {
            "client_id": client_id,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            # oidc-provider only issues a refresh token for offline_access after an explicit consent prompt.
            "prompt": "consent",
            "redirect_uri": redirect_uri,
            "resource": LOBEHUB_API_RESOURCE,
            "response_type": "code",
            "scope": scope or DEFAULT_OAUTH_SCOPE,
            "state": state,
        }
    )
    return f"{_oidc_url(base_url, 'auth')}?{query}"


def parse_authorization_callback(callback_url: str, expected_state: str) -> str:
    """The authorization code from the redirect URL, rejecting a mismatched `state`."""
    parts = urlsplit(callback_url)
    params = {k: v[0] for k, v in parse_qs(parts.query).items()}
    params.update({k: v[0] for k, v in parse_qs(parts.fragment).items()})
    if params.get("error"):
        raise OAuthError(params["error"], params.get("error_description"))
    if params.get("state") != expected_state:
        raise OAuthError("state_mismatch")
    if not params.get("code"):
        raise OAuthError("missing_code")
    return params["code"]


def _token_request(client_id: str, base_url: Optional[str], params: Dict[str, str]) -> Dict[str, Any]:
    return {
        "url": _oidc_url(base_url, "token"),
        "data": {"client_id": client_id, **params},
        "headers": {"Content-Type": "application/x-www-form-urlencoded"},
    }


def _parse_tokens(response: httpx.Response, requested_at: float) -> OAuthTokens:
    try:
        body = response.json()
    except ValueError:
        body = {}
    body = body if isinstance(body, dict) else {}
    if not response.is_success:
        error = body.get("error")
        description = body.get("error_description")
        raise OAuthError(
            error if isinstance(error, str) else f"http_{response.status_code}",
            description if isinstance(description, str) else None,
            response.status_code,
        )
    if not isinstance(body.get("access_token"), str):
        raise OAuthError("missing_access_token")
    return OAuthTokens(
        access_token=body["access_token"],
        expires_at=requested_at + float(body.get("expires_in") or 0),
        refresh_token=body.get("refresh_token") if isinstance(body.get("refresh_token"), str) else None,
        scope=body.get("scope") if isinstance(body.get("scope"), str) else None,
        token_type=str(body.get("token_type") or "Bearer"),
    )


def _post_tokens(
    client_id: str, base_url: Optional[str], params: Dict[str, str], http_client: Optional[httpx.Client]
) -> OAuthTokens:
    requested_at = time.time()
    request = _token_request(client_id, base_url, params)
    if http_client is not None:
        return _parse_tokens(http_client.post(**request), requested_at)
    with httpx.Client() as client:
        return _parse_tokens(client.post(**request), requested_at)


async def _apost_tokens(
    client_id: str, base_url: Optional[str], params: Dict[str, str], http_client: Optional[httpx.AsyncClient]
) -> OAuthTokens:
    requested_at = time.time()
    request = _token_request(client_id, base_url, params)
    if http_client is not None:
        return _parse_tokens(await http_client.post(**request), requested_at)
    async with httpx.AsyncClient() as client:
        return _parse_tokens(await client.post(**request), requested_at)


def _code_params(code: str, code_verifier: str, redirect_uri: str) -> Dict[str, str]:
    return {
        "code": code,
        "code_verifier": code_verifier,
        "grant_type": "authorization_code",
        "redirect_uri": redirect_uri,
    }


def exchange_authorization_code(
    *,
    client_id: str,
    code: str,
    code_verifier: str,
    redirect_uri: str,
    base_url: Optional[str] = None,
    http_client: Optional[httpx.Client] = None,
) -> OAuthTokens:
    """Exchange the authorization code for tokens (`authorization_code` grant)."""
    return _post_tokens(client_id, base_url, _code_params(code, code_verifier, redirect_uri), http_client)


async def async_exchange_authorization_code(
    *,
    client_id: str,
    code: str,
    code_verifier: str,
    redirect_uri: str,
    base_url: Optional[str] = None,
    http_client: Optional[httpx.AsyncClient] = None,
) -> OAuthTokens:
    return await _apost_tokens(
        client_id, base_url, _code_params(code, code_verifier, redirect_uri), http_client
    )


def refresh_access_token(
    *,
    client_id: str,
    refresh_token: str,
    base_url: Optional[str] = None,
    http_client: Optional[httpx.Client] = None,
) -> OAuthTokens:
    """
    Trade a refresh token for a new access token. The refresh token rotates:
    persist `refresh_token` from the result. `invalid_grant` means the grant is
    gone and the user has to sign in again.
    """
    params = {"grant_type": "refresh_token", "refresh_token": refresh_token}
    return _post_tokens(client_id, base_url, params, http_client)


async def async_refresh_access_token(
    *,
    client_id: str,
    refresh_token: str,
    base_url: Optional[str] = None,
    http_client: Optional[httpx.AsyncClient] = None,
) -> OAuthTokens:
    params = {"grant_type": "refresh_token", "refresh_token": refresh_token}
    return await _apost_tokens(client_id, base_url, params, http_client)


class _RefreshingBase:
    def __init__(
        self,
        *,
        client_id: str,
        tokens: OAuthTokens,
        base_url: Optional[str] = None,
        on_refresh: Optional[Callable[[OAuthTokens], Any]] = None,
    ) -> None:
        self.client_id = client_id
        self.tokens = tokens
        self.base_url = base_url
        self.on_refresh = on_refresh

    def _fresh(self) -> bool:
        return self.tokens.expires_at - REFRESH_MARGIN > time.time()

    def _refresh_token(self) -> str:
        if not self.tokens.refresh_token:
            raise OAuthError(
                "missing_refresh_token", "The access token expired and there is no refresh token"
            )
        return self.tokens.refresh_token


class RefreshingToken(_RefreshingBase):
    """
    An `access_token` provider for `LobeHub`: returns the current access token,
    refreshing it (and calling `on_refresh` with the rotated tokens, to persist
    them) a minute before it expires.
    """

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._lock = threading.Lock()

    def __call__(self) -> str:
        with self._lock:
            if not self._fresh():
                self.tokens = refresh_access_token(
                    client_id=self.client_id, refresh_token=self._refresh_token(), base_url=self.base_url
                )
                if self.on_refresh:
                    self.on_refresh(self.tokens)
            return self.tokens.access_token


class AsyncRefreshingToken(_RefreshingBase):
    """The `AsyncLobeHub` counterpart of `RefreshingToken`."""

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        # Created on first use, inside the event loop that awaits it.
        self._lock: Optional[anyio.Lock] = None

    async def __call__(self) -> str:
        if self._lock is None:
            self._lock = anyio.Lock()
        async with self._lock:
            if not self._fresh():
                self.tokens = await async_refresh_access_token(
                    client_id=self.client_id, refresh_token=self._refresh_token(), base_url=self.base_url
                )
                if self.on_refresh:
                    self.on_refresh(self.tokens)
            return self.tokens.access_token
