---
name: gortex-src-utils-4-dirs
description: 'Work in the src/utils +4 dirs area — 125 symbols across 7 files (98% cohesion)'
---

# src/utils +4 dirs

125 symbols | 7 files | 98% cohesion

## When to Use

Use this skill when working on files in:

- `packages/agent-tracing/src/cli/inspect.ts`
- `packages/agent-tracing/src/types.ts`
- `packages/agent-tracing/src/utils/reconstruct.test.ts`
- `packages/agent-tracing/src/utils/reconstruct.ts`
- `packages/agent-tracing/src/viewer/agentSignal.ts`
- `packages/agent-tracing/src/viewer/index.ts`
- `src/server/modules/AgentTracing/S3SnapshotStore.test.ts`

## Key Files

| File                                                      | Symbols                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------ |
| `packages/agent-tracing/src/cli/inspect.ts`               | step, allSteps, registerInspectCommand, findStep, isUrl, ...             |
| `packages/agent-tracing/src/types.ts`                     | ExecutionSnapshot, StepSnapshot                                          |
| `packages/agent-tracing/src/utils/reconstruct.test.ts`    | overrides, makeStep                                                      |
| `packages/agent-tracing/src/utils/reconstruct.ts`         | targetStepIndex, steps, reconstructToolsetBaseline, snapshot, steps, ... |
| `packages/agent-tracing/src/viewer/agentSignal.ts`        | snapshot, renderTimeline, analysis, snapshot, color, ...                 |
| `packages/agent-tracing/src/viewer/index.ts`              | n, step, renderSnapshot, s, renderEnvContext, ...                        |
| `src/server/modules/AgentTracing/S3SnapshotStore.test.ts` | overrides, sampleSnapshot                                                |

## Entry Points

- `packages/agent-tracing/src/cli/inspect.ts::registerInspectCommand`

## Connected Communities

- **platforms/telegram +60 dirs** (1 cross-edges)
- **src/viewer · collectStepAgentSignalEvents** (1 cross-edges)

## How to Explore

```
get_communities with id: "community-404"
smart_context with task: "understand src/utils +4 dirs", format: "gcx"
find_usages with id: "packages/agent-tracing/src/cli/inspect.ts::registerInspectCommand", format: "gcx"
```

_`format: "gcx"` returns the [GCX1 compact wire format](../../docs/wire-format.md) — round-trippable, \~27% fewer tokens than JSON. Drop it for JSON output; agents using `@gortex/wire` or the Go `github.com/gortexhq/gcx-go` package decode either._
