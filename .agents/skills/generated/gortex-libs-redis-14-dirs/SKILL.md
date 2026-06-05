---
name: gortex-libs-redis-14-dirs
description: 'Work in the libs/redis +14 dirs area — 222 symbols across 25 files (86% cohesion)'
---

# libs/redis +14 dirs

222 symbols | 25 files | 86% cohesion

## When to Use

Use this skill when working on files in:

- `packages/context-engine/src/pipeline.ts`
- `src/envs/redis.ts`
- `src/libs/better-auth/utils/config.ts`
- `src/libs/redis/manager.ts`
- `src/libs/redis/redis.test.ts`
- `src/libs/redis/redis.ts`
- `src/libs/redis/types.ts`
- `src/libs/redis/utils.ts`
- `src/server/agent-hono/handlers/toolResult.ts`
- `src/server/modules/AgentRuntime/AgentStateManager.ts`
- `src/server/modules/AgentRuntime/StreamEventManager.ts`
- `src/server/services/agent/index.ts`
- `src/server/services/agentSignal/services/briefs/selfReview.ts`
- `src/server/services/agentSignal/store/adapters/redis/policyStateStore.ts`
- `src/server/services/agentSignal/store/adapters/redis/receiptStore.ts`
- `src/server/services/agentSignal/store/adapters/redis/shared.ts`
- `src/server/services/agentSignal/store/adapters/redis/sourceEventStore.ts`
- `src/server/services/file/impls/s3.ts`
- `src/server/services/generation/latency.ts`
- `src/server/services/home/index.ts`
- `src/server/services/messenger/MessengerRouter.test.ts`
- `src/server/services/messenger/MessengerRouter.ts`
- `src/server/services/messenger/linkTokenStore.ts`
- `src/server/services/messenger/oauth/stateStore.ts`
- `src/server/services/messenger/platforms/telegram/binder.ts`

## Key Files

| File                                                                       | Symbols                                                                                                         |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `packages/context-engine/src/pipeline.ts`                                  | ContextEngineConfig                                                                                             |
| `src/envs/redis.ts`                                                        | getRedisConfig                                                                                                  |
| `src/libs/better-auth/utils/config.ts`                                     | set, ttl, key, value, key, ...                                                                                  |
| `src/libs/redis/manager.ts`                                                | config, config, createProvider, initialize, config, ...                                                         |
| `src/libs/redis/redis.test.ts`                                             | createMockedProvider, createPipelineMock, loadRedisProvider, buildRedisConfig                                   |
| `src/libs/redis/redis.ts`                                                  | setex, keys, mget, pipe.set, key, ...                                                                           |
| `src/libs/redis/types.ts`                                                  | RedisClient, RedisConfig, RedisValue, RedisSetResult, RedisKey, ...                                             |
| `src/libs/redis/utils.ts`                                                  | key, key, normalizeRedisKeys, options, normalizeMsetValues, ...                                                 |
| `src/server/agent-hono/handlers/toolResult.ts`                             | c, toolResult                                                                                                   |
| `src/server/modules/AgentRuntime/AgentStateManager.ts`                     | releaseStepLock, saveStepResult, data, operationId, stepResult, ...                                             |
| `src/server/modules/AgentRuntime/StreamEventManager.ts`                    | operationId, cleanupOperation                                                                                   |
| `src/server/services/agent/index.ts`                                       | agentId, getAgentWelcomeFromRedis                                                                               |
| `src/server/services/agentSignal/services/briefs/selfReview.ts`            | toolInput, tools.completeOperation                                                                              |
| `src/server/services/agentSignal/store/adapters/redis/policyStateStore.ts` | data, scopeKey, ttlSeconds, writePolicyState, policyId                                                          |
| `src/server/services/agentSignal/store/adapters/redis/receiptStore.ts`     | appendReceipt, toReceiptHash, receipt, receipt, ttlSeconds                                                      |
| `src/server/services/agentSignal/store/adapters/redis/shared.ts`           | ttlSeconds, key, data, key, ttlSeconds, ...                                                                     |
| `src/server/services/agentSignal/store/adapters/redis/sourceEventStore.ts` | acquireScopeLock, data, writeWindow, ttlSeconds, scopeKey, ...                                                  |
| `src/server/services/file/impls/s3.ts`                                     | url, createPresignedPreviewCacheKey, getPresignedPreviewCacheTtlSeconds, createPreSignedUrlForPreview, url, ... |
| `src/server/services/generation/latency.ts`                                | model, queryTrimmedAvgLatency, model, getRedis, model, ...                                                      |
| `src/server/services/home/index.ts`                                        | constructor, userId, HomeBriefData, readDailyBriefFromRedis, HomeService, ...                                   |
| `src/server/services/messenger/MessengerRouter.test.ts`                    | createAdapter, createClient                                                                                     |
| `src/server/services/messenger/MessengerRouter.ts`                         | getOrCreateBot, loadBot, creds                                                                                  |
| `src/server/services/messenger/linkTokenStore.ts`                          | issueLinkToken, platformUserId, LinkToken, consumedKey, consumeLinkToken, ...                                   |
| `src/server/services/messenger/oauth/stateStore.ts`                        | state, consumeOAuthState, issueOAuthState, stateKey, payload, ...                                               |
| `src/server/services/messenger/platforms/telegram/binder.ts`               | buildVerifyImUrl, ctx, handleUnlinkedMessage, raw, params, ...                                                  |

## Entry Points

- `src/libs/redis/redis.test.ts::createMockedProvider`

## Connected Communities

- **services/agentSignal · claim** (3 cross-edges)
- **bot/platforms +8 dirs** (1 cross-edges)
- **server · getWebhookHandler** (1 cross-edges)
- **services/messenger +1 dirs** (1 cross-edges)
- **modules/AgentRuntime +1 dirs · createAgentRuntimeRedisClient** (1 cross-edges)
- **modules/AgentRuntime · tryClaimStep** (1 cross-edges)
- **main/services +4 dirs** (1 cross-edges)

## How to Explore

```
get_communities with id: "community-3224"
smart_context with task: "understand libs/redis +14 dirs", format: "gcx"
find_usages with id: "src/libs/redis/redis.test.ts::createMockedProvider", format: "gcx"
```

_`format: "gcx"` returns the [GCX1 compact wire format](../../docs/wire-format.md) — round-trippable, \~27% fewer tokens than JSON. Drop it for JSON output; agents using `@gortex/wire` or the Go `github.com/gortexhq/gcx-go` package decode either._
