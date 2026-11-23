# @lobehub/sdk

Official TypeScript SDK for the [LobeHub REST API](https://app.lobehub.com/api/v1/docs), generated from the OpenAPI spec in [`packages/openapi`](../openapi) via [@hey-api/openapi-ts](https://heyapi.dev).

Resource-style methods with full typing — every path, parameter, request body, and response comes from `openapi.yml` — plus a hand-written layer for workspaces, retries, typed errors, pagination, streaming and uploads. The HTTP runtime is inlined (zero dependencies). See [`CHANGELOG.md`](./CHANGELOG.md) for release notes and [`examples/`](./examples) for runnable scripts.

## Installation

```bash
npm install @lobehub/sdk
```

## Usage

```ts
import { createLobeHub } from '@lobehub/sdk';

const lobehub = createLobeHub({
  // LobeHub API Key (`sk-lh-...`) or an OIDC JWT
  apiKey: process.env.LOBEHUB_API_KEY!,
});

const me = await lobehub.users.me();
const { data, error } = await lobehub.agents.list({ query: { limit: 20 } });
const agent = await lobehub.agents.get({ path: { id: 'agt_...' } });

await lobehub.topics.create({ body: { agentId: 'agt_...', title: 'Planning' } });
```

Every method resolves to `{ data, error, request, response }`: `data` is the response body (the `{ success, data, timestamp }` envelope for most routes) and `error` is set instead when the API answers with an error — see [Errors](#errors).

Point the client at another deployment with `baseURL`, and pass any other client option (custom `fetch`, `headers`, …):

```ts
const lobehub = createLobeHub({ apiKey: 'sk-lh-...', baseURL: 'http://localhost:3010' });
```

Raw spec types are exported from `@lobehub/sdk` and `@lobehub/sdk/types`.

## Resources

35 resources, one per top-level path segment of the API. Method names come from each operation's `operationId` (`<resource>.<method>`) in the spec: `list` / `get` / `create` / `update` / `delete` plus PascalCase sub-segments (`files.listChunks`, `roles.updatePermissions`), and a few verbs declared by the route itself (`files.uploadBatch`, `tasks.run`, `notifications.markRead`). Each method's JSDoc names the API key scopes it needs.

| Resource              | Methods                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentGroups`         | `create`, `delete`, `get`, `list`, `update`                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `agents`              | `create`, `createAccount`, `createDuplicate`, `delete`, `deleteAccount`, `get`, `getAccount`, `list`, `listAccounts`, `update`, `updateAccount`, `updateAccountCredential`                                                                                                                                                                                                                                                                                                            |
| `apiKeys`             | `create`, `delete`, `get`, `list`, `update`                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `audio`               | `createSpeech`, `createTranscription`                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `chat`                | `create`, `createGenerateReply`, `createTranslate`                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `chatGroups`          | `addMembers`, `create`, `delete`, `get`, `list`, `removeMembers`, `update`                                                                                                                                                                                                                                                                                                                                                                                                            |
| `documents`           | `create`, `get`, `list`, `update`                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `eval`                | `createBenchmarks`, `createDatasets`, `createDatasetsTestCases`, `createRuns`, `createRunsClaim`, `createRunsResults`, `createRunsRetryErrors`, `deleteBenchmarks`, `deleteDatasets`, `deleteTestCases`, `getBenchmarks`, `getDatasets`, `getRuns`, `getTestCases`, `listBenchmarks`, `listDatasets`, `listDatasetsTestCases`, `listRuns`, `listRunsResults`, `listRunsTopics`, `updateBenchmarks`, `updateDatasets`, `updateRunsStatus`, `updateRunsTopicsResult`, `updateTestCases` |
| `files`               | `create`, `createChunks`, `delete`, `get`, `getUrl`, `list`, `listChunks`, `parse`, `query`, `update`, `uploadBatch`                                                                                                                                                                                                                                                                                                                                                                  |
| `generations`         | `delete`, `get`, `list`                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `goals`               | `advance`, `create`, `delete`, `get`, `getSupervision`, `list`, `pause`, `restart`, `resume`, `update`                                                                                                                                                                                                                                                                                                                                                                                |
| `health`              | `check`                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `im`                  | `markRead`, `send`, `sync`                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `images`              | `generate`                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `knowledgeBases`      | `addFiles`, `create`, `delete`, `get`, `list`, `listFiles`, `moveFiles`, `removeFiles`, `update`                                                                                                                                                                                                                                                                                                                                                                                      |
| `mcpServers`          | `create`, `createSync`, `delete`, `get`, `list`, `update`                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `memories`            | `deleteAll`, `deleteEntry`, `getPersona`, `listCategory`, `listPersonaVersions`                                                                                                                                                                                                                                                                                                                                                                                                       |
| `messageTranslations` | `create`, `delete`, `get`, `update`                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `messages`            | `create`, `createReply`, `delete`, `deleteMany`, `get`, `getCount`, `list`                                                                                                                                                                                                                                                                                                                                                                                                            |
| `models`              | `create`, `get`, `list`, `update`                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `notifications`       | `archive`, `archiveAll`, `getCounts`, `getUnreadCount`, `list`, `listSettings`, `markAllRead`, `markRead`, `updateSettings`                                                                                                                                                                                                                                                                                                                                                           |
| `objects`             | `generate`                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `permissions`         | `create`, `delete`, `get`, `list`, `update`                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `plugins`             | `list`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `providers`           | `create`, `delete`, `get`, `list`, `update`                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `pushTokens`          | `register`, `unregister`                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `responses`           | `create`                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `roles`               | `create`, `delete`, `deletePermissions`, `get`, `list`, `listPermissions`, `update`, `updatePermissions`                                                                                                                                                                                                                                                                                                                                                                              |
| `signals`             | `emit`, `listReceipts`, `trigger`                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `tasks`               | `create`, `delete`, `get`, `list`, `listRuns`, `run`, `update`, `updateStatus`                                                                                                                                                                                                                                                                                                                                                                                                        |
| `text`                | `generate`                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `topics`              | `create`, `delete`, `get`, `list`, `listThreads`, `update`                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `usage`               | `list`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `users`               | `create`, `delete`, `deleteRoles`, `get`, `list`, `listRoles`, `me`, `update`, `updateRoles`                                                                                                                                                                                                                                                                                                                                                                                          |
| `videos`              | `generate`                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Workspaces

Pass `workspaceId` to act inside a workspace: every request then carries `X-Workspace-Id`. A per-call header still wins.

```ts
const team = createLobeHub({ apiKey: process.env.LOBEHUB_API_KEY!, workspaceId: 'ws_...' });
await team.agents.list(); // the workspace's agents

await team.agents.list({ headers: { 'X-Workspace-Id': 'ws_other' } });
```

A personal API key cannot send the header (403 `workspace_mismatch`); a workspace API key is bound to its workspace, so `workspaceId` may be omitted and, when set, must name that workspace.

## Errors

An error answer comes back as a `LobeHubAPIError` with `status`, `code` (stable, see `ApiErrorCode` — branch on it, not on `message`), `requestId` (quote it when reporting an issue), `details` (one `{ path, message }` per field for `validation_error`), `headers` and the raw `body`. Network failures are `LobeHubConnectionError`, and `LobeHubTimeoutError` when the [`timeout`](#retries-and-timeouts) runs out.

By default methods do not throw:

```ts
import { LobeHubAPIError } from '@lobehub/sdk';

const { data, error } = await lobehub.agents.get({ path: { id } });
if (error) {
  if (error instanceof LobeHubAPIError && error.code === 'not_found') return null;
  throw error;
}
```

Opt into throwing per call with `throwOnError: true`, or for the whole client — then every method rejects with the error and `data` is typed as always present:

```ts
const lobehub = createLobeHub({ apiKey, throwOnError: true });

try {
  const { data } = await lobehub.agents.get({ path: { id } });
  console.log(data.data.title);
} catch (error) {
  if (error instanceof LobeHubAPIError) console.error(error.status, error.code, error.requestId);
}
```

## Retries and timeouts

Requests that are safe to resend are retried up to `maxRetries` times (default 2) on 408, 429, 5xx and network errors, with exponential backoff (\~0.5s, 1s, 2s … up to 8s, with jitter) or exactly the server's `Retry-After`. Safe means an idempotent method (`GET`, `HEAD`, `OPTIONS`, `PUT`, `DELETE`) or a `POST` with an idempotency key — a plain `POST` is never resent, and the server only deduplicates keyed `POST`s, so a key on `PATCH` does not make it retryable. A keyed `POST` resent while the first attempt is still running gets 409 `idempotency_conflict`; the SDK waits and retries it, until the stored answer comes back or the retries run out.

`timeout` (default 10 minutes, `0` disables) bounds the wait for the response headers of each attempt. Both work on the client and per call:

```ts
const lobehub = createLobeHub({ apiKey, maxRetries: 4, timeout: 30_000 });

await lobehub.agents.list({ maxRetries: 0, timeout: 5000 });

// The server runs a keyed request once and replays its answer for repeats,
// so the key also makes this POST retryable.
await lobehub.agents.create({
  body: { title: 'Researcher' },
  idempotencyKey: crypto.randomUUID(),
});
```

## Pagination

List endpoints answer `{ hasMore, nextCursor }` pages. `paginate` walks all of them and yields the items (`items`, or the endpoint's own key such as `agents`):

```ts
for await (const agent of lobehub.paginate(lobehub.agents.list, { query: { limit: 100 } })) {
  console.log(agent.id, agent.title);
}
```

The method can be passed unbound; query parameters other than `cursor` are sent with every page.

## Streaming responses

`responses.stream` starts a response with `stream: true` and yields typed OpenResponses events (`ResponseStreamEvent`, generated from the spec). `finalResponse()` drains it and resolves with the response object of the last event; `abort()` (or breaking out of the loop) closes the connection.

```ts
const stream = lobehub.responses.stream({ input: 'Summarize my week', model: 'agt_...' });

for await (const event of stream) {
  if (event.type === 'response.output_text.delta') process.stdout.write(event.delta);
  if (event.type === 'response.failed') console.error(event.response.error);
}
```

```ts
const response = await lobehub.responses.stream({ input, model }).finalResponse();
console.log(response.output_text);
```

## Uploads

`files.upload` takes a `File`, a `Blob`, raw bytes (`Buffer`, `Uint8Array`, `ArrayBuffer`) or a local file path (Node, Bun, Deno), plus the other upload fields:

```ts
await lobehub.files.upload('./report.pdf', { knowledgeBaseId: 'kb_...' });
await lobehub.files.upload(new File([text], 'notes.md', { type: 'text/markdown' }));
await lobehub.files.upload(buffer, { name: 'image.png', type: 'image/png' });
```

The file name defaults to the `File` name or the path's base name, and the type to the `Blob` type.

## Generations

`text.generate` and `objects.generate` run one completion and answer at once — the REST twins of `lh generate text` and `lh generate json`. A reasoning model's reasoning comes back in `reasoning`, never inside `text`; `objects.generate` returns an object that matches your JSON Schema, or 422 when the model's reply does not:

```ts
const { data: text } = await lobehub.text.generate({
  body: { model: 'deepseek-flash', provider: 'lobehub', prompt: 'Name a pegboard use.' },
});
console.log(text?.data.text);

const { data: concept } = await lobehub.objects.generate({
  body: {
    prompt: 'A pegboard headphone hanger',
    schema: {
      additionalProperties: false,
      properties: { name: { type: 'string' }, steps: { items: { type: 'string' }, type: 'array' } },
      required: ['name', 'steps'],
      type: 'object',
    },
    strict: true,
  },
});
console.log(concept?.data.object);
```

`images.generate` and `videos.generate` start image / video generations (API keys need `generation:write`). Images wait for the result by default; videos answer at once with pending generations. `generations.wait` polls `GET /generations/{id}` until the generation is `success` or `error` and resolves with its final state; it rejects with `GenerationWaitTimeoutError` after `timeout` (10 minutes by default).

```ts
const { data } = await lobehub.videos.generate({
  body: { model: 'seedance-1-0-pro', prompt: 'Waves at sunset', provider: 'volcengine' },
});
const video = await lobehub.generations.wait(data!.data.generations[0].id, {
  onPoll: (generation) => console.log(generation.status),
  pollInterval: 5000,
});
if (video.status === 'success') console.log(video.asset?.url);
else console.error(video.error?.message);
```

### Signing in with OAuth (native apps)

Public clients registered in LobeHub's OIDC provider (`lobehub-mobile`, `toby`, …) sign in with authorization code + PKCE. Open the authorize URL in the system browser session (`ASWebAuthenticationSession`, Custom Tabs), then exchange the callback:

```ts
import {
  createAuthorizationUrl,
  createLobeHub,
  createPkcePair,
  exchangeAuthorizationCode,
  parseAuthorizationCallback,
  refreshAccessToken,
} from '@lobehub/sdk';

const client = { clientId: 'toby', redirectUri: 'https://app.lobehub.com/oidc/callback/toby' };
const pkce = await createPkcePair(); // or create it natively where crypto.subtle is missing
const url = createAuthorizationUrl({ ...client, codeChallenge: pkce.challenge, state });

const code = parseAuthorizationCallback(callbackUrl, state);
let tokens = await exchangeAuthorizationCode({ ...client, code, codeVerifier: pkce.verifier });

const lobehub = createLobeHub({
  accessToken: async () => {
    if (tokens.expiresAt - Date.now() < 60_000) {
      tokens = await refreshAccessToken({
        clientId: client.clientId,
        refreshToken: tokens.refreshToken!,
      });
    }
    return tokens.accessToken;
  },
});
```

Refresh tokens rotate, so persist the one returned by every refresh. A `LobeHubOAuthError` with `code: 'invalid_grant'` means the user has to sign in again.

## Development

- `bun generate` — regenerate `src/generated/` from `../openapi/openapi.yml` (run after the spec changes). Names come from the spec's operationIds; the naming rule lives in `packages/openapi/src/common/operation-id.ts`.
- `bun run build` — build ESM + d.ts to `dist/`
- `bun run test` — unit tests (mock `fetch`) + the generated-output drift check

PR CI runs this package's tests (it is in the `PACKAGES` list of [`test.yml`](../../.github/workflows/test.yml)), so a spec change without the regenerated SDK fails the PR.

## Releasing

[`release-sdk.yml`](../../.github/workflows/release-sdk.yml) publishes on every push to `canary` that touches `packages/sdk/**` or `packages/openapi/openapi.yml` (and on `workflow_dispatch`), after the drift check, tests and build. [`scripts/release-version.ts`](./scripts/release-version.ts) picks the version:

- `package.json` `version` not on npm yet → published to `latest`. It needs a `## [x.y.z] - date` section in `CHANGELOG.md`, and the bump has to match the section: `### Breaking` → major, `### Added` → at least minor, `### Changed` / `### Fixed` → patch. A breaking change is expressed this way and cannot go out as a smaller bump.
- Already on npm → `x.y.(z+1)-canary.<UTC timestamp>` under the `canary` dist-tag, so `latest` only moves on a changelogged release.

To cut a release, bump `version` and add its CHANGELOG section in the PR that changes the SDK's surface.
