---
name: gortex-src-commands-3-dirs
description: 'Work in the src/commands +3 dirs area — 207 symbols across 48 files (90% cohesion)'
---

# src/commands +3 dirs

207 symbols | 48 files | 90% cohesion

## When to Use

Use this skill when working on files in:

- `apps/cli/src/api/client.ts`
- `apps/cli/src/commands/agent-group.test.ts`
- `apps/cli/src/commands/agent-group.ts`
- `apps/cli/src/commands/agent.test.ts`
- `apps/cli/src/commands/agent.ts`
- `apps/cli/src/commands/bot.test.ts`
- `apps/cli/src/commands/bot.ts`
- `apps/cli/src/commands/botMessage.test.ts`
- `apps/cli/src/commands/botMessage.ts`
- `apps/cli/src/commands/botMessengers.test.ts`
- `apps/cli/src/commands/botMessengers.ts`
- `apps/cli/src/commands/config.test.ts`
- `apps/cli/src/commands/config.ts`
- `apps/cli/src/commands/connect.ts`
- `apps/cli/src/commands/device.ts`
- `apps/cli/src/commands/doc.test.ts`
- `apps/cli/src/commands/doc.ts`
- `apps/cli/src/commands/file.test.ts`
- `apps/cli/src/commands/file.ts`
- `apps/cli/src/commands/generate.test.ts`
- `apps/cli/src/commands/hetero.ts`
- `apps/cli/src/commands/kb.test.ts`
- `apps/cli/src/commands/kb.ts`
- `apps/cli/src/commands/memory.test.ts`
- `apps/cli/src/commands/memory.ts`
- `apps/cli/src/commands/message.test.ts`
- `apps/cli/src/commands/message.ts`
- `apps/cli/src/commands/model.test.ts`
- `apps/cli/src/commands/model.ts`
- `apps/cli/src/commands/plugin.test.ts`
- `apps/cli/src/commands/plugin.ts`
- `apps/cli/src/commands/provider.test.ts`
- `apps/cli/src/commands/provider.ts`
- `apps/cli/src/commands/search.test.ts`
- `apps/cli/src/commands/search.ts`
- `apps/cli/src/commands/session-group.test.ts`
- `apps/cli/src/commands/session-group.ts`
- `apps/cli/src/commands/skill.test.ts`
- `apps/cli/src/commands/skill.ts`
- `apps/cli/src/commands/status.test.ts`
- `apps/cli/src/commands/status.ts`
- `apps/cli/src/commands/topic.test.ts`
- `apps/cli/src/commands/topic.ts`
- `apps/cli/src/commands/user.test.ts`
- `apps/cli/src/commands/user.ts`
- `apps/cli/src/utils/BatchIngester.ts`
- `apps/cli/src/utils/TrpcIngestSink.ts`
- `packages/heterogeneous-agents/src/spawn/spawnAgent.ts`

## Key Files

| File                                                    | Symbols                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `apps/cli/src/api/client.ts`                            | TrpcClient, auth, getAuthAndServer, createLambdaClient, ToolsTrpcClient, ...   |
| `apps/cli/src/commands/agent-group.test.ts`             | createProgram                                                                  |
| `apps/cli/src/commands/agent-group.ts`                  | program, registerAgentGroupCommand                                             |
| `apps/cli/src/commands/agent.test.ts`                   | createProgram                                                                  |
| `apps/cli/src/commands/agent.ts`                        | status, program, registerAgentCommand, colorStatus                             |
| `apps/cli/src/commands/bot.test.ts`                     | createProgram                                                                  |
| `apps/cli/src/commands/bot.ts`                          | push, bot, buildPayload, findBot, registerWatchKeywordsCommand, ...            |
| `apps/cli/src/commands/botMessage.test.ts`              | createProgram                                                                  |
| `apps/cli/src/commands/botMessage.ts`                   | resolveAttachmentFlags, value, registerBotMessageCommands, flags, bot, ...     |
| `apps/cli/src/commands/botMessengers.test.ts`           | createProgram                                                                  |
| `apps/cli/src/commands/botMessengers.ts`                | value, MessengerPlatform, bot, validatePlatform, registerBotMessengersCommands |
| `apps/cli/src/commands/config.test.ts`                  | createProgram                                                                  |
| `apps/cli/src/commands/config.ts`                       | program, registerConfigCommand                                                 |
| `apps/cli/src/commands/connect.ts`                      | options, error, buildDaemonArgs, msg                                           |
| `apps/cli/src/commands/device.ts`                       | registerDeviceCommand, program                                                 |
| `apps/cli/src/commands/doc.test.ts`                     | createProgram                                                                  |
| `apps/cli/src/commands/doc.ts`                          | registerDocCommand, program, options, readBodyContent                          |
| `apps/cli/src/commands/file.test.ts`                    | createProgram                                                                  |
| `apps/cli/src/commands/file.ts`                         | program, registerFileCommand                                                   |
| `apps/cli/src/commands/generate.test.ts`                | stream.start, controller                                                       |
| `apps/cli/src/commands/hetero.ts`                       | runOneAgent, inflight, text, snapshotFlushMs, onSigterm, ...                   |
| `apps/cli/src/commands/kb.test.ts`                      | createProgram                                                                  |
| `apps/cli/src/commands/kb.ts`                           | parentId, program, depth, fetchItems, fileType, ...                            |
| `apps/cli/src/commands/memory.test.ts`                  | createProgram                                                                  |
| `apps/cli/src/commands/memory.ts`                       | Category, program, buildCategoryInput, registerMemoryCommand, client, ...      |
| `apps/cli/src/commands/message.test.ts`                 | createProgram                                                                  |
| `apps/cli/src/commands/message.ts`                      | program, registerMessageCommand                                                |
| `apps/cli/src/commands/model.test.ts`                   | createProgram                                                                  |
| `apps/cli/src/commands/model.ts`                        | registerModelCommand, program                                                  |
| `apps/cli/src/commands/plugin.test.ts`                  | createProgram                                                                  |
| `apps/cli/src/commands/plugin.ts`                       | registerPluginCommand, program                                                 |
| `apps/cli/src/commands/provider.test.ts`                | createProgram                                                                  |
| `apps/cli/src/commands/provider.ts`                     | program, registerProviderCommand                                               |
| `apps/cli/src/commands/search.test.ts`                  | createProgram                                                                  |
| `apps/cli/src/commands/search.ts`                       | program, query, options, renderResultGroup, options, ...                       |
| `apps/cli/src/commands/session-group.test.ts`           | createProgram                                                                  |
| `apps/cli/src/commands/session-group.ts`                | registerSessionGroupCommand, program                                           |
| `apps/cli/src/commands/skill.test.ts`                   | createProgram                                                                  |
| `apps/cli/src/commands/skill.ts`                        | SourceType, source, program, detectSourceType, registerSkillCommand            |
| `apps/cli/src/commands/status.test.ts`                  | createProgram                                                                  |
| `apps/cli/src/commands/status.ts`                       | registerStatusCommand, program                                                 |
| `apps/cli/src/commands/topic.test.ts`                   | createProgram                                                                  |
| `apps/cli/src/commands/topic.ts`                        | registerTopicCommand, depth, printMessage, program, m                          |
| `apps/cli/src/commands/user.test.ts`                    | createProgram                                                                  |
| `apps/cli/src/commands/user.ts`                         | program, registerUserCommand                                                   |
| `apps/cli/src/utils/BatchIngester.ts`                   | IngestSink                                                                     |
| `apps/cli/src/utils/TrpcIngestSink.ts`                  | params, operationId, constructor, ingest, events, ...                          |
| `packages/heterogeneous-agents/src/spawn/spawnAgent.ts` | wake, defaultCommand, killProcessTree, SpawnAgentOptions, signal, ...          |

## Entry Points

- `apps/cli/src/commands/agent.ts::registerAgentCommand`
- `apps/cli/src/commands/topic.ts::registerTopicCommand`
- `apps/cli/src/commands/hetero.ts::exec`

## Connected Communities

- **src/commands +1 dirs · info** (10 cross-edges)
- **src/transformation +60 dirs** (3 cross-edges)
- **src/commands · resolvePrompt** (1 cross-edges)
- **slices/data +7 dirs** (1 cross-edges)
- **cli/src · getValidToken** (1 cross-edges)
- **src/commands · parseAttachmentArg** (1 cross-edges)
- **src/spawn · buildSpawnArgs** (1 cross-edges)
- **src/spawn +9 dirs** (1 cross-edges)
- **src/spawn +7 dirs** (1 cross-edges)
- **platforms/wechat +7 dirs** (1 cross-edges)

## How to Explore

```
get_communities with id: "community-45"
smart_context with task: "understand src/commands +3 dirs", format: "gcx"
find_usages with id: "apps/cli/src/commands/agent.ts::registerAgentCommand", format: "gcx"
```

_`format: "gcx"` returns the [GCX1 compact wire format](../../docs/wire-format.md) — round-trippable, \~27% fewer tokens than JSON. Drop it for JSON output; agents using `@gortex/wire` or the Go `github.com/gortexhq/gcx-go` package decode either._
