# Changelog

All notable changes to `@lobehub/sdk`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

Each release sorts its entries into `### Breaking`, `### Added`, `### Changed` and `### Fixed`. A `Breaking` entry needs a major bump and an `Added` one at least a minor bump; the release workflow refuses to publish a version whose bump is smaller than its section requires (see "Releasing" in the README).

## \[1.1.0] - 2026-11-17

First semver release. Versions before it were published as `1.0.<UTC timestamp>` on every push.

### Added

- `createLobeHub({ workspaceId })` sends `X-Workspace-Id` on every request; a per-call header still overrides it.
- `timeout` (default 10 minutes, until the response headers) and `maxRetries` (default 2) on the client and on every call. Retries back off exponentially on 408, 429, 5xx and network errors, honor `Retry-After`, and only resend idempotent methods (`GET`, `HEAD`, `OPTIONS`, `PUT`, `DELETE`) or a `POST` that carries an `Idempotency-Key` (whose in-flight 409 `idempotency_conflict` is waited out too).
- `idempotencyKey` call option, sent as the `Idempotency-Key` header.
- Typed errors: `LobeHubAPIError` (`status`, `code`, `requestId`, `details`, `headers`, `body`), `LobeHubConnectionError` and `LobeHubTimeoutError`.
- `createLobeHub({ throwOnError: true })` makes every method reject with `LobeHubAPIError` and types `data` as always present.
- `lobehub.paginate(method, options)`: an async iterator over every item of a cursor-paginated list (`hasMore` / `nextCursor`).
- `lobehub.responses.stream(body)`: typed OpenResponses server-sent events (`ResponseStreamEvent`) as an `AsyncIterable`, plus `finalResponse()` and `abort()`.
- `lobehub.files.upload(source, options)` for a `File`, `Blob`, `Buffer` / `Uint8Array` / `ArrayBuffer`, or a local file path.
- Generated types for every streaming event (`ResponseCreatedEvent`, `ResponseOutputTextDeltaEvent`, …) and the `X-Workspace-Id` / `Idempotency-Key` headers on each operation.
- Each method's JSDoc lists the API key scopes it needs.

### Changed

- An error answer now comes back as a `LobeHubAPIError` instance instead of the plain JSON body. It still carries the body's fields (`success`, `code`, `message`, `details`, `requestId`, `timestamp`, `error`), so code reading them is unaffected; code that compared the error with `toEqual` against a plain object, or serialized it, sees an `Error` now.
- Idempotent requests are retried twice by default; pass `maxRetries: 0` for the previous behavior.
- Method names now come from the spec's `operationId`s (`agents.list`, `files.uploadBatch`, …) instead of a naming table in the generator config. Every method and type name is unchanged.
