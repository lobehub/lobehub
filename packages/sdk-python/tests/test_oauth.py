from __future__ import annotations

import base64
import hashlib
import time
from typing import List
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from lobehub import AsyncLobeHub, LobeHub
from lobehub.oauth import (
    LOBEHUB_API_RESOURCE,
    AsyncRefreshingToken,
    OAuthError,
    OAuthTokens,
    RefreshingToken,
    async_refresh_access_token,
    create_authorization_url,
    create_pkce_pair,
    exchange_authorization_code,
    parse_authorization_callback,
    refresh_access_token,
)

from .conftest import MockServer, Reply, envelope


def test_pkce_pair_uses_s256() -> None:
    pair = create_pkce_pair()
    digest = base64.urlsafe_b64encode(hashlib.sha256(pair.verifier.encode()).digest()).decode().rstrip("=")
    assert pair.challenge == digest
    assert len(pair.verifier) == 43 and "=" not in pair.verifier


def test_authorization_url() -> None:
    url = create_authorization_url(
        client_id="lobehub-cli",
        redirect_uri="http://127.0.0.1:8765/callback",
        code_challenge="abc",
        state="s1",
        base_url="https://self.host/",
    )
    parts = urlsplit(url)
    assert f"{parts.scheme}://{parts.netloc}{parts.path}" == "https://self.host/oidc/auth"
    query = {k: v[0] for k, v in parse_qs(parts.query).items()}
    assert query == {
        "client_id": "lobehub-cli",
        "code_challenge": "abc",
        "code_challenge_method": "S256",
        "prompt": "consent",
        "redirect_uri": "http://127.0.0.1:8765/callback",
        "resource": LOBEHUB_API_RESOURCE,
        "response_type": "code",
        "scope": "profile email offline_access",
        "state": "s1",
    }


def test_parse_authorization_callback() -> None:
    assert parse_authorization_callback("app://cb?code=c%201&state=s", "s") == "c 1"
    with pytest.raises(OAuthError) as mismatch:
        parse_authorization_callback("app://cb?code=c&state=other", "s")
    assert mismatch.value.code == "state_mismatch"
    with pytest.raises(OAuthError) as denied:
        parse_authorization_callback("app://cb?error=access_denied&error_description=No", "s")
    assert (denied.value.code, str(denied.value)) == ("access_denied", "No")
    with pytest.raises(OAuthError, match="missing_code"):
        parse_authorization_callback("app://cb?state=s", "s")


def test_exchange_and_refresh(server: MockServer) -> None:
    server.reply(
        Reply(
            body={"access_token": "at1", "expires_in": 3600, "refresh_token": "rt1", "token_type": "Bearer"}
        ),
        Reply(400, {"error": "invalid_grant", "error_description": "Grant expired"}),
    )
    before = time.time()
    tokens = exchange_authorization_code(
        client_id="lobehub-cli",
        code="c",
        code_verifier="v",
        redirect_uri="app://cb",
        base_url=server.base_url,
    )
    assert (tokens.access_token, tokens.refresh_token) == ("at1", "rt1")
    assert before + 3600 <= tokens.expires_at <= time.time() + 3600
    request = server.requests[0]
    assert (request.method, request.path) == ("POST", "/oidc/token")
    assert {k: v[0] for k, v in parse_qs(request.body.decode()).items()} == {
        "client_id": "lobehub-cli",
        "code": "c",
        "code_verifier": "v",
        "grant_type": "authorization_code",
        "redirect_uri": "app://cb",
    }

    with pytest.raises(OAuthError) as caught:
        refresh_access_token(client_id="lobehub-cli", refresh_token="rt1", base_url=server.base_url)
    assert (caught.value.code, caught.value.status) == ("invalid_grant", 400)


def test_refreshing_token_refreshes_before_expiry(server: MockServer) -> None:
    saved: List[OAuthTokens] = []
    server.reply(Reply(body={"access_token": "fresh", "expires_in": 3600, "refresh_token": "rt2"}))
    server.default = Reply(body=envelope({"id": "user_1"}))
    provider = RefreshingToken(
        client_id="lobehub-cli",
        tokens=OAuthTokens(access_token="stale", expires_at=time.time() + 30, refresh_token="rt1"),
        base_url=server.base_url,
        on_refresh=saved.append,
    )
    client = LobeHub(access_token=provider, base_url=server.base_url)

    client.users.me()
    client.users.me()

    assert [r.path for r in server.requests] == ["/oidc/token", "/api/v1/users/me", "/api/v1/users/me"]
    assert [r.headers["authorization"] for r in server.requests[1:]] == ["Bearer fresh", "Bearer fresh"]
    assert [t.refresh_token for t in saved] == ["rt2"]


def test_refreshing_token_without_refresh_token() -> None:
    provider = RefreshingToken(client_id="c", tokens=OAuthTokens(access_token="x", expires_at=0))
    with pytest.raises(OAuthError, match="refresh token"):
        provider()


@pytest.mark.anyio
async def test_async_refresh(server: MockServer) -> None:
    server.reply(Reply(body={"access_token": "a1", "expires_in": 60}))
    tokens = await async_refresh_access_token(client_id="c", refresh_token="r", base_url=server.base_url)
    assert tokens.access_token == "a1" and tokens.refresh_token is None

    server.reply(Reply(body={"access_token": "a2", "expires_in": 3600, "refresh_token": "r2"}))
    server.default = Reply(body=envelope({"id": "user_1"}))
    provider = AsyncRefreshingToken(
        client_id="c",
        tokens=OAuthTokens(access_token="old", expires_at=0, refresh_token="r"),
        base_url=server.base_url,
    )
    async with AsyncLobeHub(access_token=provider, base_url=server.base_url) as client:
        await client.users.me()
    assert server.requests[-1].headers["authorization"] == "Bearer a2"


def test_token_endpoint_non_json_failure() -> None:
    transport = httpx.MockTransport(lambda request: httpx.Response(502, text="gateway down"))
    with pytest.raises(OAuthError) as caught:
        refresh_access_token(client_id="c", refresh_token="r", http_client=httpx.Client(transport=transport))
    assert caught.value.code == "http_502"
