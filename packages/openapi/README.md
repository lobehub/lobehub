# @lobechat/openapi

LobeHub's public REST API (`/api/v1`), built with Hono + zod. `openapi.yml` is generated from the routes — run `bun run --cwd packages/openapi generate:openapi`, never edit it by hand. The SDK in `packages/sdk` is generated from that file.

This file documents the conventions every route follows. The same text ships in the spec's `info.description`.

## Errors

Every error answers with the shared `ApiError` body:

```json
{
  "code": "validation_error",
  "details": [{ "path": "query.limit", "message": "Too big: expected number to be <=100" }],
  "error": "Invalid request: query.limit Too big: expected number to be <=100",
  "message": "Invalid request: query.limit Too big: expected number to be <=100",
  "requestId": "req_6f1c…",
  "success": false,
  "timestamp": "2026-11-17T10:00:00.000Z"
}
```

- `code` is stable and machine-readable; branch on it, not on `message`.
- `details` appears on validation errors: one `{ path, message }` per failing field. `path` is dotted and starts with the request part (`json`, `query`, `param`, `header`).
- `requestId` equals the `X-Request-Id` response header, which every response carries. A client-supplied `X-Request-Id` (≤128 chars of `[A-Za-z0-9_.:-]`) is echoed back.
- `error` is the pre-`code` string field, kept as a deprecated alias of `message`.

Throw `ApiException(status, code, message, details?)` from `src/common/errors.ts` to pick a code; an `HTTPException` or a service error without one gets the default code for its status.

### Error codes

The catalogue lives in `API_ERROR_CODES` (`src/common/errors.ts`) and is published as the `ApiErrorCode` schema. Codes are only ever added.

| Code                   | Status   | Meaning                                                                                                 |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `validation_error`     | 400      | The request failed schema validation; `details` lists each failing field.                               |
| `bad_request`          | 400      | The request was understood but cannot be processed as sent.                                             |
| `unauthorized`         | 401      | Authentication is missing, invalid or expired.                                                          |
| `payment_required`     | 402      | The operation needs credits or a plan the caller lacks.                                                 |
| `forbidden`            | 403      | The caller is authenticated but may not perform this operation.                                         |
| `insufficient_scope`   | 403      | The API key lacks a capability scope this operation requires.                                           |
| `workspace_mismatch`   | 403      | `X-Workspace-Id` does not match the API key, or the caller is not a member of that workspace.           |
| `not_found`            | 404      | The resource does not exist or is not visible to the caller.                                            |
| `conflict`             | 409      | The request conflicts with the current state of the resource.                                           |
| `idempotency_conflict` | 409, 422 | The `Idempotency-Key` is still being processed (409), or was first used with a different request (422). |
| `precondition_failed`  | 412      | A precondition of the operation is not met.                                                             |
| `payload_too_large`    | 413      | The request body exceeds the size this operation accepts.                                               |
| `unprocessable_entity` | 422      | The request is valid but cannot be applied to the resource.                                             |
| `rate_limited`         | 429      | Too many requests for this API key. Retry after `Retry-After` seconds.                                  |
| `internal_error`       | 500      | An unexpected server error. Safe to retry with backoff.                                                 |
| `upstream_error`       | 502      | An upstream provider failed while serving the request.                                                  |
| `service_unavailable`  | 503      | A dependency is temporarily unavailable.                                                                |

`POST /api/v1/responses` speaks OpenResponses, so its HTTP errors keep the protocol's body — `{ "error": { "type", "message", "code", "param" }, "requestId" }` — with `code` taken from the same catalogue. The heterogeneous-agent relays (`/anthropic`, `/openai`) keep their vendors' error bodies; they still carry `X-Request-Id`.

## Pagination

List endpoints take `limit` (1–100, default 20) and an opaque `cursor`, and answer:

```json
{ "data": { "items": [], "total": 42, "hasMore": true, "nextCursor": "bzoyMA" }, "success": true }
```

Pass `nextCursor` back as `cursor` for the next page; it is `null` on the last page. New endpoints name the array `items` and accept only `cursor` + `limit`; existing endpoints keep their own key (`agents`, `topics`, …) and still accept the deprecated `page`/`pageSize` and `offset`.

Build new lists with `src/helpers/pagination.ts`:

- `CursorPaginationQuerySchema` — the `cursor` + `limit` query.
- `paginatedListSchema(itemSchema, { key?, total? })` — the response payload schema.
- `resolvePagination(query)` → `{ limit, offset }`, accepting every supported style.
- `BaseController.list(c, key, payload)` — answers with `hasMore`/`nextCursor` added.

`GET /agent-groups`, `/api-keys` and `/mcp-servers` used to answer a bare array. They now answer `{ items, total, hasMore, nextCursor }`; pass the deprecated `format=array` to get the old bare array (all items, unpaginated) while migrating.

## Rate limits

Requests authenticated with an API key are counted per key in Redis (`redisService.openapi`), 600 per minute by default (`OPENAPI_RATE_LIMIT_PER_MINUTE`). Responses carry `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` (Unix seconds); a refused request answers 429 `rate_limited` with `Retry-After` in seconds. OIDC sessions and operation tokens are not limited. Without Redis the limit fails open.

## Idempotency

Any authenticated `POST` accepts an `Idempotency-Key` header (1–255 chars). The first request with a key runs; a repeat with the same key and the same request (method, path, body) within 24 hours gets the stored response back with `Idempotent-Replayed: true`. Keys are scoped to the user, the credential (API key) and the resolved workspace, so a replay never crosses keys or workspaces — the middleware runs before route guards, and another key must pass its own. A repeat while the first is still running answers 409, and reuse with a different request answers 422 (both `idempotency_conflict`). Server errors, 429s and streamed responses are not stored, so those can be retried with the same key. A request still running after 5 minutes gives up its in-flight claim; a retry after that runs again, and the first request's late result is not stored over it.
