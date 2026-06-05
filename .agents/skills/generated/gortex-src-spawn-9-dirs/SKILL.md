---
name: gortex-src-spawn-9-dirs
description: 'Work in the src/spawn +9 dirs area — 149 symbols across 13 files (87% cohesion)'
---

# src/spawn +9 dirs

149 symbols | 13 files | 87% cohesion

## When to Use

Use this skill when working on files in:

- `apps/desktop/src/main/controllers/BrowserWindowsCtr.ts`
- `apps/desktop/src/main/controllers/HeterogeneousAgentCtr.ts`
- `apps/desktop/src/main/libs/acp/types.ts`
- `apps/desktop/src/main/modules/heterogeneousAgent/types.ts`
- `apps/desktop/src/main/modules/toolDetectors/cliAgentDetectors.ts`
- `packages/electron-client-ipc/src/types/heterogeneousAgent.ts`
- `packages/heterogeneous-agents/src/askUser/AskUserMcpServer.ts`
- `packages/heterogeneous-agents/src/spawn/agentStreamPipeline.ts`
- `packages/heterogeneous-agents/src/spawn/cliSpawn.ts`
- `packages/heterogeneous-agents/src/spawn/spawnAgent.ts`
- `packages/openapi/src/types/agent.type.ts`
- `src/routes/(main)/community/(detail)/provider/features/Sidebar/ActionButton/ProviderConfig.tsx`
- `src/store/chat/slices/aiChat/actions/heterogeneousAgentExecutor.ts`

## Key Files

| File                                                                                             | Symbols                                                                                                    |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/main/controllers/BrowserWindowsCtr.ts`                                         | openSettingsWindow, options                                                                                |
| `apps/desktop/src/main/controllers/HeterogeneousAgentCtr.ts`                                     | buildCodexCliMissingError, afterAppReady, getSessionErrorPayload, groupName, shouldTraceCliOutput, ...     |
| `apps/desktop/src/main/libs/acp/types.ts`                                                        | ACPSessionCancelParams, ACPSessionCompleteEvent                                                            |
| `apps/desktop/src/main/modules/heterogeneousAgent/types.ts`                                      | HeterogeneousAgentImageAttachment                                                                          |
| `apps/desktop/src/main/modules/toolDetectors/cliAgentDetectors.ts`                               | agentType, HeterogeneousCliAgentType, detectHeterogeneousCliCommand, command                               |
| `packages/electron-client-ipc/src/types/heterogeneousAgent.ts`                                   | HeterogeneousAgentSessionError                                                                             |
| `packages/heterogeneous-agents/src/askUser/AskUserMcpServer.ts`                                  | bridge, registerOperation, url, operationId, operationId, ...                                              |
| `packages/heterogeneous-agents/src/spawn/agentStreamPipeline.ts`                                 | constructor, AgentStreamPipelineOptions, sessionId, options, operationId, ...                              |
| `packages/heterogeneous-agents/src/spawn/cliSpawn.ts`                                            | args, isWindows, command, CliSpawnPlan, isPathLikeCommand, ...                                             |
| `packages/heterogeneous-agents/src/spawn/spawnAgent.ts`                                          | sessionId                                                                                                  |
| `packages/openapi/src/types/agent.type.ts`                                                       | AgentSessionLinkRequest                                                                                    |
| `src/routes/(main)/community/(detail)/provider/features/Sidebar/ActionButton/ProviderConfig.tsx` | openSettings                                                                                               |
| `src/store/chat/slices/aiChat/actions/heterogeneousAgentExecutor.ts`                             | agentType, maybeClassifyCliAuthRequiredError, buildCliAuthRequiredSessionError, agentType, rawMessage, ... |

## Connected Communities

- **src/transformation +60 dirs** (7 cross-edges)
- **src/askUser +1 dirs** (5 cross-edges)
- **src/commands +3 dirs** (2 cross-edges)
- **main/controllers +4 dirs** (2 cross-edges)
- **src/spawn +7 dirs** (1 cross-edges)
- **src/spawn · execFileString** (1 cross-edges)
- **modules/toolDetectors +2 dirs** (1 cross-edges)
- **src/main · runSendPrompt** (1 cross-edges)
- **src/askUser +3 dirs · AskUserMcpServer** (1 cross-edges)
- **modules/toolDetectors** (1 cross-edges)
- **src/spawn · getExistingShimPathToken** (1 cross-edges)

## How to Explore

```
get_communities with id: "community-148"
smart_context with task: "understand src/spawn +9 dirs", format: "gcx"
```

_`format: "gcx"` returns the [GCX1 compact wire format](../../docs/wire-format.md) — round-trippable, \~27% fewer tokens than JSON. Drop it for JSON output; agents using `@gortex/wire` or the Go `github.com/gortexhq/gcx-go` package decode either._
