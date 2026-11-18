"""The README's examples, type-checked by mypy (`files` in pyproject.toml) so they cannot rot."""

from __future__ import annotations

import secrets
from pathlib import Path

from lobehub import AsyncLobeHub, LobeHub, NotFoundError, PermissionDeniedError
from lobehub.oauth import (
    RefreshingToken,
    create_authorization_url,
    create_pkce_pair,
    exchange_authorization_code,
    parse_authorization_callback,
)


def quick_start(client: LobeHub) -> None:
    me = client.users.me()
    print(me["id"])
    for agent in client.agents.iter_list(limit=50):
        print(agent["id"], agent["title"])

    agent = client.agents.create({"title": "Reviewer", "systemRole": "Review pull requests."})
    client.agents.update(agent["id"], {"description": "Reviews PRs"})
    client.topics.list(agent_id=agent["id"], limit=20)


async def asynchronous() -> None:
    async with AsyncLobeHub() as client:
        await client.users.me()
        async for topic in client.topics.iter_list(limit=50):
            print(topic["id"])


def oauth(callback_url: str) -> LobeHub:
    pkce, state = create_pkce_pair(), secrets.token_urlsafe(16)
    redirect_uri = "http://127.0.0.1:8765/callback"
    create_authorization_url(
        client_id="my-app", redirect_uri=redirect_uri, code_challenge=pkce.challenge, state=state
    )
    code = parse_authorization_callback(callback_url, state)
    tokens = exchange_authorization_code(
        client_id="my-app", code=code, code_verifier=pkce.verifier, redirect_uri=redirect_uri
    )
    return LobeHub(access_token=RefreshingToken(client_id="my-app", tokens=tokens, on_refresh=print))


def workspaces_retries_errors(client: LobeHub) -> None:
    client.agents.list(workspace_id="ws_other")
    team = client.with_options(workspace_id="ws_team")
    team.agents.get("agt_1", timeout=5, max_retries=0)
    client.agents.create({"title": "Reviewer"}, idempotency_key="create-reviewer-1")
    try:
        client.agents.get("agt_missing")
    except NotFoundError as error:
        print(error.status_code, error.code, error.message, error.request_id)
    except PermissionDeniedError as error:
        if error.code == "insufficient_scope":
            pass


def pages_streams_uploads(client: LobeHub) -> None:
    for message in client.messages.iter_list(topic_id="tpc_1", limit=100):
        print(message["content"])
    for topic in client.paginate(client.topics.list, limit=50):
        print(topic)

    with client.responses.stream({"model": "agt_1", "input": "Summarize the open PR comments"}) as stream:
        for event in stream:
            if event["type"] == "response.output_text.delta":
                print(event["delta"], end="", flush=True)
        final = stream.final_response()
    print(final["status"], final["output"])

    for raw in client.stream_events("GET", "/api/v1/health"):
        print(raw.event, raw.json())

    uploaded = client.files.upload("./report.pdf", knowledge_base_id="kb_1")
    print(uploaded["file"]["id"])
    client.files.upload(b"raw bytes", name="notes.txt")
    with open("photo.png", "rb") as photo:
        client.files.upload(photo)
    client.files.upload_batch({"files": [Path("a.pdf"), ("b.csv", b"x,y\n1,2")]})

    response = client.request("GET", "/api/v1/health")
    print(response.headers["X-RateLimit-Remaining"])
