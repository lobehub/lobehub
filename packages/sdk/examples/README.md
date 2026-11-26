# @lobehub/sdk examples

Runnable with Bun from `packages/sdk` (the `@lobehub/sdk` import resolves to `src/` through `tsconfig.json`):

```bash
export LOBEHUB_API_KEY=sk-lh-...
# export LOBEHUB_BASE_URL=http://localhost:3010   # another deployment

bun examples/quickstart.ts
```

| File                               | Shows                                                     |
| ---------------------------------- | --------------------------------------------------------- |
| [`quickstart.ts`](./quickstart.ts) | `users.me`, `agents.list`                                 |
| [`workspace.ts`](./workspace.ts)   | `workspaceId` → `X-Workspace-Id` (`LOBEHUB_WORKSPACE_ID`) |
| [`errors.ts`](./errors.ts)         | `LobeHubAPIError` returned vs thrown (`throwOnError`)     |
| [`retries.ts`](./retries.ts)       | `timeout`, `maxRetries`, `idempotencyKey`                 |
| [`pagination.ts`](./pagination.ts) | `paginate` over every topic                               |
| [`streaming.ts`](./streaming.ts)   | `responses.stream` (`LOBEHUB_AGENT_ID`)                   |
| [`upload.ts`](./upload.ts)         | `files.upload` from a path, bytes and a `Blob`            |

`retries.ts` and `upload.ts` create and then delete an agent / files in the account.
