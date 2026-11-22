# LobeHub Python SDK

Official Python client for the [LobeHub REST API](https://app.lobehub.com/api/v1/docs). Every resource, method and schema is generated from [`packages/openapi/openapi.yml`](../openapi/openapi.yml), the same spec the [TypeScript SDK](../sdk) is generated from, so method names match: `agents.list` is `lobehub.agents.list()` in TypeScript and `client.agents.list()` here.

- Sync (`LobeHub`) and async (`AsyncLobeHub`) clients on [httpx](https://www.python-httpx.org/)
- Request and response schemas as `TypedDict`s (`lobehub.types`): checked by mypy / pyright, plain dicts at runtime
- API key or OIDC access token (with a refreshing provider), `workspace_id`
- Timeouts and safe retries (`Retry-After`, `Idempotency-Key`), typed errors
- Page iterators, server-sent event streaming for `/responses`, file uploads

Requires Python 3.9+.

```bash
pip install lobehub
```

## Quick start

```python
from lobehub import LobeHub

client = LobeHub(api_key="sk-lh-...")  # or set LOBEHUB_API_KEY

me = client.users.me()
print(me["id"])

for agent in client.agents.iter_list(limit=50):
    print(agent["id"], agent["title"])
```

Methods return the `data` of the API's `{ success, data, timestamp }` envelope, typed by the spec. Path parameters are positional, query and header parameters are keyword arguments in snake\_case, and a request body is a dict passed as `body` (keys exactly as in the API):

```python
agent = client.agents.create({"title": "Reviewer", "systemRole": "Review pull requests."})
client.agents.update(agent["id"], {"description": "Reviews PRs"})
topics = client.topics.list(agent_id=agent["id"], limit=20)
```

Every method also takes `extra_headers`, `extra_query`, `extra_body`, `timeout` and `max_retries`.

## Async

```python
import asyncio
from lobehub import AsyncLobeHub


async def main() -> None:
    async with AsyncLobeHub() as client:
        me = await client.users.me()
        async for topic in client.topics.iter_list(limit=50):
            print(topic["id"])


asyncio.run(main())
```

## Authentication

| Option         | Use                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------- |
| `api_key`      | A LobeHub API key (`sk-lh-...`) or an OIDC JWT. Defaults to `LOBEHUB_API_KEY`.            |
| `access_token` | An OIDC access token, or a function returning the current one (called before each call).  |
| `base_url`     | A self-hosted deployment. Defaults to `LOBEHUB_BASE_URL`, then `https://app.lobehub.com`. |

A restricted API key only reaches operations whose scopes it holds; each method's docstring lists them (`**API key scopes:** ...`).

### OIDC sign-in (PKCE)

`lobehub.oauth` mirrors the TypeScript SDK's helpers for native and CLI apps:

```python
import secrets
from lobehub import LobeHub
from lobehub.oauth import (
    RefreshingToken,
    create_authorization_url,
    create_pkce_pair,
    exchange_authorization_code,
    parse_authorization_callback,
)

pkce, state = create_pkce_pair(), secrets.token_urlsafe(16)
url = create_authorization_url(
    client_id="my-app",
    redirect_uri="http://127.0.0.1:8765/callback",
    code_challenge=pkce.challenge,
    state=state,
)
# Open `url` in the browser, receive the redirect on your callback, then:
code = parse_authorization_callback(callback_url, state)
tokens = exchange_authorization_code(
    client_id="my-app", code=code, code_verifier=pkce.verifier, redirect_uri="http://127.0.0.1:8765/callback"
)

# Refreshes a minute before expiry; persist the rotated refresh token in on_refresh.
client = LobeHub(access_token=RefreshingToken(client_id="my-app", tokens=tokens, on_refresh=save_tokens))
```

`AsyncRefreshingToken` and `async_exchange_authorization_code` / `async_refresh_access_token` do the same for `AsyncLobeHub`.

## Workspaces

```python
client = LobeHub(workspace_id="ws_...")  # every request acts inside the workspace
client.agents.list(workspace_id="ws_other")  # one call elsewhere
team = client.with_options(workspace_id="ws_team")  # a copy sharing the connection pool
```

Closing a `with_options()` copy leaves the shared pool open; close the original client. `workspace_id` is sent as `X-Workspace-Id`. A personal API key cannot send it; a workspace API key is bound to its workspace.

## Timeouts and retries

```python
client = LobeHub(timeout=30, max_retries=4)
client.agents.get("agt_...", timeout=5, max_retries=0)
```

- `timeout` (seconds, default 600) bounds each attempt; `0` disables it. For a stream it bounds each wait for the next bytes.
- `max_retries` (default 2) resends on 408, 429, 500, 502, 503, 504 and connection failures, with exponential backoff (\~0.5s, 1s, 2s … 8s, ±25% jitter) or the server's `Retry-After` (up to 60s; a longer wait raises instead).
- Only requests that cannot double-apply are retried: `GET` / `PUT` / `DELETE` / `HEAD` / `OPTIONS`, and a `POST` sent with `idempotency_key=`. A keyed `POST` that answers 409 `idempotency_conflict` (the first attempt is still running) is retried until the stored answer comes back.

```python
client.agents.create({"title": "Reviewer"}, idempotency_key="create-reviewer-1")
```

## Errors

Every non-2xx answer raises an `APIError` subclass carrying the `ApiError` body:

| Status | Exception                  |
| ------ | -------------------------- |
| 400    | `BadRequestError`          |
| 401    | `AuthenticationError`      |
| 403    | `PermissionDeniedError`    |
| 404    | `NotFoundError`            |
| 409    | `ConflictError`            |
| 422    | `UnprocessableEntityError` |
| 429    | `RateLimitError`           |
| 5xx    | `InternalServerError`      |
| other  | `APIError`                 |

```python
from lobehub import NotFoundError, PermissionDeniedError

try:
    client.agents.get("agt_missing")
except NotFoundError as error:
    print(error.status_code, error.code, error.message, error.request_id)
except PermissionDeniedError as error:
    if error.code == "insufficient_scope":
        ...
```

`code` is the stable machine-readable code (`ApiErrorCode`: `validation_error`, `insufficient_scope`, `workspace_mismatch`, …); `details` lists the failing fields of a `validation_error`. A request that never got an answer raises `APIConnectionError`, or `APITimeoutError` when it timed out. All of them derive from `LobeHubError`.

## Pagination

Each cursor-paginated list has a typed `iter_*` twin that walks every page:

```python
for message in client.messages.iter_list(topic_id="tpc_...", limit=100):
    print(message["content"])
```

`client.paginate(client.topics.list, limit=50)` does the same for any list method. Call the list method itself for one page (`items`, `hasMore`, `nextCursor`).

## Streaming responses

```python
with client.responses.stream({"model": "agt_...", "input": "Summarize the open PR comments"}) as stream:
    for event in stream:
        if event["type"] == "response.output_text.delta":
            print(event["delta"], end="", flush=True)
    final = stream.final_response()

print(final["status"], final["output"])
```

Events are the spec's `ResponseStreamEvent` union. Leaving the loop early closes the connection. `client.responses.create(...)` returns the whole response object once the run ends. For any other `text/event-stream` endpoint, `client.stream_events("GET", path)` yields raw `ServerSentEvent`s (`.event`, `.data`, `.json()`).

## File uploads

```python
uploaded = client.files.upload("./report.pdf", knowledge_base_id="kb_...")
print(uploaded["file"]["id"])
client.files.upload(b"raw bytes", name="notes.txt")
client.files.upload(open("photo.png", "rb"))
client.files.upload_batch({"files": [Path("a.pdf"), ("b.csv", b"x,y\n1,2")]})
```

A source is a path (`str` / `pathlib.Path`), bytes, a binary file object or a `(name, content[, content_type])` tuple. The content type is guessed from the file name unless given.

## Raw access

```python
response = client.request("GET", "/api/v1/health")  # httpx.Response, with auth, workspace and retries
print(response.headers["X-RateLimit-Remaining"])
```

Pass your own `httpx.Client` / `httpx.AsyncClient` as `http_client=` for proxies, custom transports or mocking.

## Development

The SDK lives in the LobeHub monorepo next to the spec it is generated from. With [uv](https://docs.astral.sh/uv/):

```bash
cd packages/sdk-python
uv sync
uv run python scripts/generate.py          # regenerate src/lobehub/generated from openapi.yml
uv run python scripts/generate.py --check  # what CI runs: fails when generated code is stale
uv run pytest
uv run mypy
uv run ruff check . && uv run ruff format --check .
```

`src/lobehub/generated/` is committed and never edited by hand: when a route changes, run `bun run --cwd packages/openapi generate:openapi`, then the generator above, and commit both. The hand-written layer (`_base_client.py`, `_streaming.py`, `_resources.py`, `oauth.py`, …) holds what the spec cannot describe.

Releases are published to PyPI by the manual **Release Python SDK** workflow; see [CHANGELOG.md](./CHANGELOG.md).
