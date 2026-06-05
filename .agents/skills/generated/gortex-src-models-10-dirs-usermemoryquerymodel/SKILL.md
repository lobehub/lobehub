---
name: gortex-src-models-10-dirs-usermemoryquerymodel
description: 'Work in the src/models +10 dirs · UserMemoryQueryModel area — 145 symbols across 14 files (88% cohesion)'
---

# src/models +10 dirs · UserMemoryQueryModel

145 symbols | 14 files | 88% cohesion

## When to Use

Use this skill when working on files in:

- `packages/database/src/models/agent.ts`
- `packages/database/src/models/topic.ts`
- `packages/database/src/models/user.ts`
- `packages/database/src/models/userMemory/__tests__/query.test.ts`
- `packages/database/src/models/userMemory/model.ts`
- `packages/database/src/models/userMemory/query.ts`
- `packages/database/src/schemas/_helpers.ts`
- `packages/database/src/schemas/userMemories/index.ts`
- `packages/memory-user-memory/src/providers/chatTopic.ts`
- `packages/memory-user-memory/src/types.ts`
- `packages/types/src/topic/topic.ts`
- `packages/types/src/userMemory/tools.ts`
- `src/server/services/agentSignal/services/selfIteration/review/server.ts`
- `src/store/page/slices/list/action.ts`

## Key Files

| File                                                                      | Symbols                                             |
| ------------------------------------------------------------------------- | --------------------------------------------------- |
| `packages/database/src/models/agent.ts`                                   | agents, agents, result.orderBy, result.orderBy      |
| `packages/database/src/models/topic.ts`                                   | buildTopicOrderBy, sortBy                           |
| `packages/database/src/models/user.ts`                                    | fields, orderBy                                     |
| `packages/database/src/models/userMemory/__tests__/query.test.ts`         | createPreferencePair, opts                          |
| `packages/database/src/models/userMemory/model.ts`                        | buildTextSearchCondition, params                    |
| `packages/database/src/models/userMemory/query.ts`                        | limit, query, query, params, limit, ...             |
| `packages/database/src/schemas/_helpers.ts`                               | updatedAt, accessedAt, createdAt, timestamptz, name |
| `packages/database/src/schemas/userMemories/index.ts`                     | UserMemoryIdentitiesWithoutVectors                  |
| `packages/memory-user-memory/src/providers/chatTopic.ts`                  | buildContext, userId                                |
| `packages/memory-user-memory/src/types.ts`                                | BuiltContext                                        |
| `packages/types/src/topic/topic.ts`                                       | TopicQuerySortBy                                    |
| `packages/types/src/userMemory/tools.ts`                                  | SearchMemoryParams                                  |
| `src/server/services/agentSignal/services/selfIteration/review/server.ts` | collector.listRelevantMemories                      |
| `src/store/page/slices/list/action.ts`                                    | documentItemToLobeDocument, document                |

## Connected Communities

- **models/userMemory · scoreHybridCandidates** (6 cross-edges)
- **models/userMemory · buildContainsCondition** (1 cross-edges)

## How to Explore

```
get_communities with id: "community-1002"
smart_context with task: "understand src/models +10 dirs · UserMemoryQueryModel", format: "gcx"
```

_`format: "gcx"` returns the [GCX1 compact wire format](../../docs/wire-format.md) — round-trippable, \~27% fewer tokens than JSON. Drop it for JSON output; agents using `@gortex/wire` or the Go `github.com/gortexhq/gcx-go` package decode either._
