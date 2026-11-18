from __future__ import annotations

from pathlib import Path

import pytest

from lobehub import AsyncLobeHub, LobeHub, LobeHubError, __version__

from .conftest import API_KEY, MockServer, Reply, envelope


def make(server: MockServer, **options: object) -> LobeHub:
    return LobeHub(api_key=API_KEY, base_url=server.base_url, **options)  # type: ignore[arg-type]


def test_sends_api_key_user_agent_and_unwraps_the_envelope(server: MockServer) -> None:
    server.reply(Reply(body=envelope({"id": "user_1", "email": "a@b.c"})))

    me = make(server).users.me()

    assert me["id"] == "user_1"
    request = server.requests[0]
    assert (request.method, request.path) == ("GET", "/api/v1/users/me")
    assert request.headers["authorization"] == f"Bearer {API_KEY}"
    assert request.headers["user-agent"] == f"lobehub-python/{__version__}"
    assert "x-workspace-id" not in request.headers


def test_access_token_provider_is_called_for_every_request(server: MockServer) -> None:
    tokens = iter(["jwt-1", "jwt-2"])
    server.default = Reply(body=envelope({"id": "user_1"}))
    client = LobeHub(access_token=lambda: next(tokens), base_url=server.base_url)

    client.users.me()
    client.users.me()

    assert [r.headers["authorization"] for r in server.requests] == ["Bearer jwt-1", "Bearer jwt-2"]


def test_access_token_takes_precedence_over_api_key(server: MockServer) -> None:
    server.reply(Reply(body=envelope({"id": "user_1"})))
    LobeHub(api_key=API_KEY, access_token="jwt", base_url=server.base_url).users.me()
    assert server.requests[0].headers["authorization"] == "Bearer jwt"


def test_reads_api_key_and_base_url_from_the_environment(
    server: MockServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("LOBEHUB_API_KEY", API_KEY)
    monkeypatch.setenv("LOBEHUB_BASE_URL", server.base_url + "/")
    server.reply(Reply(body=envelope({"id": "user_1"})))

    LobeHub().users.me()

    assert server.requests[0].headers["authorization"] == f"Bearer {API_KEY}"


def test_requires_a_credential(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LOBEHUB_API_KEY", raising=False)
    with pytest.raises(LobeHubError, match="api_key"):
        LobeHub()
    with pytest.raises(LobeHubError, match="api_key"):
        AsyncLobeHub()


def test_workspace_id_default_per_call_override_and_with_options(server: MockServer) -> None:
    server.default = Reply(body=envelope({"items": [], "hasMore": False, "nextCursor": None, "total": 0}))
    client = make(server, workspace_id="ws_default")

    client.agent_groups.list()
    client.agent_groups.list(workspace_id="ws_call")
    scoped = client.with_options(workspace_id="ws_scoped", timeout=5)
    scoped.agent_groups.list()
    client.agent_groups.list()

    assert [r.headers["x-workspace-id"] for r in server.requests] == [
        "ws_default",
        "ws_call",
        "ws_scoped",
        "ws_default",
    ]
    assert scoped.timeout == 5 and client.timeout != 5
    assert scoped.agent_groups._client is scoped


def test_path_query_and_json_body_serialization(server: MockServer) -> None:
    server.default = Reply(body=envelope({"items": [], "hasMore": False, "nextCursor": None, "total": 0}))
    client = make(server)

    client.topics.list(include_triggers=["cron", "api"], limit=5, agent_id=None)
    client.notifications.list(unread_only=True)
    client.agents.update("agt/1 x", {"title": "Renamed"})

    topics, notifications, update = server.requests
    assert topics.query == {"includeTriggers": ["cron", "api"], "limit": ["5"]}
    assert notifications.query == {"unreadOnly": ["true"]}
    assert (update.method, update.path) == ("PATCH", "/api/v1/agents/agt%2F1%20x")
    assert update.json() == {"title": "Renamed"}


def test_extra_headers_and_extra_query(server: MockServer) -> None:
    server.reply(Reply(body=envelope({"id": "user_1"})))
    make(server).users.me(extra_headers={"X-Trace": "t1"}, extra_query={"debug": True})
    request = server.requests[0]
    assert request.headers["x-trace"] == "t1"
    assert request.query == {"debug": ["true"]}


def test_non_enveloped_json_is_returned_whole(server: MockServer) -> None:
    server.reply(Reply(body={"id": "resp_1", "object": "response", "status": "completed", "output": []}))
    response = make(server).responses.create({"model": "agt_1", "input": "hi"})
    assert response["id"] == "resp_1"


def test_binary_response_and_extra_body(server: MockServer, tmp_path: Path) -> None:
    server.reply(Reply(body=b"ID3audio", headers={"Content-Type": "audio/mpeg"}))
    # The spec does not describe this route's body yet: `extra_body` sends it anyway.
    audio = make(server).audio.create_speech(
        extra_body={"input": "hello", "model": "tts-1", "voice": "alloy"}
    )
    assert audio.content == b"ID3audio"
    assert audio.content_type == "audio/mpeg"
    assert server.requests[0].json() == {"input": "hello", "model": "tts-1", "voice": "alloy"}
    audio.write_to_file(tmp_path / "speech.mp3")
    assert (tmp_path / "speech.mp3").read_bytes() == b"ID3audio"


def test_extra_body_merges_into_the_typed_body(server: MockServer) -> None:
    server.reply(Reply(body=envelope({"id": "agt_1"})))
    make(server).agents.update("agt_1", {"title": "T"}, extra_body={"beta": 1})
    assert server.requests[0].json() == {"title": "T", "beta": 1}


def test_raw_request_escape_hatch(server: MockServer) -> None:
    server.reply(Reply(body=envelope({"ok": True}), headers={"X-RateLimit-Remaining": "41"}))
    response = make(server).request("GET", "/api/v1/health", query={"verbose": True})
    assert response.status_code == 200
    assert response.headers["x-ratelimit-remaining"] == "41"
    assert response.json()["data"] == {"ok": True}
    assert server.requests[0].query == {"verbose": ["true"]}


def test_context_manager_closes_the_owned_pool(server: MockServer) -> None:
    with make(server) as client:
        pass
    assert client._http.is_closed


@pytest.mark.anyio
async def test_async_client(server: MockServer) -> None:
    server.default = Reply(body=envelope({"id": "user_1"}))

    async def token() -> str:
        return "jwt-async"

    async with AsyncLobeHub(access_token=token, base_url=server.base_url, workspace_id="ws_1") as client:
        me = await client.users.me()
        other = client.with_options(workspace_id="ws_2")
        await other.users.me()

    assert me["id"] == "user_1"
    assert server.requests[0].headers["authorization"] == "Bearer jwt-async"
    assert [r.headers["x-workspace-id"] for r in server.requests] == ["ws_1", "ws_2"]
