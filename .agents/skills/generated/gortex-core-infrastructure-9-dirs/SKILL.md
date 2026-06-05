---
name: gortex-core-infrastructure-9-dirs
description: 'Work in the core/infrastructure +9 dirs area — 122 symbols across 15 files (91% cohesion)'
---

# core/infrastructure +9 dirs

122 symbols | 15 files | 91% cohesion

## When to Use

Use this skill when working on files in:

- `apps/desktop/src/main/core/infrastructure/BackendProxyProtocolManager.ts`
- `apps/desktop/src/main/core/infrastructure/LocalFileProtocolManager.ts`
- `apps/desktop/src/main/core/infrastructure/RendererProtocolManager.ts`
- `apps/desktop/src/main/core/infrastructure/StoreManager.ts`
- `apps/desktop/src/main/core/infrastructure/ToolDetectorManager.ts`
- `apps/desktop/src/main/core/infrastructure/__tests__/BackendProxyProtocolManager.test.ts`
- `apps/desktop/src/main/types/store.ts`
- `packages/local-file-shell/src/contentSearch/index.ts`
- `packages/local-file-shell/src/fileSearch/index.ts`
- `packages/local-file-shell/src/toolDetector.ts`
- `src/routes/(main)/agent/channel/detail/postSaveContext.ts`
- `src/routes/(main)/resource/features/store/action.ts`
- `src/routes/(main)/resource/features/store/index.ts`
- `src/server/services/bot/platforms/feishu/gateway.test.ts`
- `src/server/services/market/index.ts`

## Key Files

| File                                                                                      | Symbols                                                                                 |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `apps/desktop/src/main/core/infrastructure/BackendProxyProtocolManager.ts`                | logger, options, options, BackendProxyProtocolManager, session, ...                     |
| `apps/desktop/src/main/core/infrastructure/LocalFileProtocolManager.ts`                   | register, token, token, verifyPreviewToken, cleanupExpiredTokens, ...                   |
| `apps/desktop/src/main/core/infrastructure/RendererProtocolManager.ts`                    | protocolScheme, resolveRendererFilePath, handlerRegistered, is404Html, constructor, ... |
| `apps/desktop/src/main/core/infrastructure/StoreManager.ts`                               | app, app, clear, has, K, ...                                                            |
| `apps/desktop/src/main/core/infrastructure/ToolDetectorManager.ts`                        | isRegistered, categoryMap, name, getBestTool, getAllStatus, ...                         |
| `apps/desktop/src/main/core/infrastructure/__tests__/BackendProxyProtocolManager.test.ts` | getRemoteBaseUrl                                                                        |
| `apps/desktop/src/main/types/store.ts`                                                    | StoreKey                                                                                |
| `packages/local-file-shell/src/contentSearch/index.ts`                                    | toolDetector, createContentSearchImpl                                                   |
| `packages/local-file-shell/src/fileSearch/index.ts`                                       | createFileSearchModule, toolDetector                                                    |
| `packages/local-file-shell/src/toolDetector.ts`                                           | ToolDetector                                                                            |
| `src/routes/(main)/agent/channel/detail/postSaveContext.ts`                               | ChannelPostSaveRegistry                                                                 |
| `src/routes/(main)/resource/features/store/action.ts`                                     | set, get, \_api, store, publicState, ...                                                |
| `src/routes/(main)/resource/features/store/index.ts`                                      | createStore                                                                             |
| `src/server/services/bot/platforms/feishu/gateway.test.ts`                                | MockEventDispatcher                                                                     |
| `src/server/services/market/index.ts`                                                     | params, registerUser                                                                    |

## Connected Communities

- **src/main · normalizeAbsolutePath** (1 cross-edges)
- **infrastructure/migration · runStoreMigrations** (1 cross-edges)

## How to Explore

```
get_communities with id: "community-201"
smart_context with task: "understand core/infrastructure +9 dirs", format: "gcx"
```

_`format: "gcx"` returns the [GCX1 compact wire format](../../docs/wire-format.md) — round-trippable, \~27% fewer tokens than JSON. Drop it for JSON output; agents using `@gortex/wire` or the Go `github.com/gortexhq/gcx-go` package decode either._
