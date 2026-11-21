# Changelog

## 0.1.0

First release of the official Python SDK, generated from `packages/openapi/openapi.yml`.

- `LobeHub` and `AsyncLobeHub` clients with every REST operation as `client.<resource>.<method>()`, named after its operationId like the TypeScript SDK.
- Request and response schemas as `TypedDict`s in `lobehub.types`.
- API key or OIDC access token (static, callable, or the refreshing `lobehub.oauth.RefreshingToken`), plus the PKCE sign-in helpers.
- `workspace_id` per client, per call, or through `with_options()`.
- Per-attempt timeouts and retries with backoff, `Retry-After` and `Idempotency-Key` support.
- Typed errors (`NotFoundError`, `RateLimitError`, …) carrying `code`, `details` and `request_id`.
- `iter_*` page iterators and `client.paginate()`.
- `responses.stream()` server-sent event streaming with `final_response()`, and `stream_events()` for any SSE endpoint.
- `files.upload()` from a path, bytes, a file object or a tuple.
