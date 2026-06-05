---
name: gortex-services-bot-registerhandlers
description: 'Work in the services/bot · registerHandlers area — 149 symbols across 6 files (86% cohesion)'
---

# services/bot · registerHandlers

149 symbols | 6 files | 86% cohesion

## When to Use

Use this skill when working on files in:

- `src/server/services/bot/AgentBridgeService.ts`
- `src/server/services/bot/BotMessageRouter.ts`
- `src/server/services/bot/__tests__/replyTemplate.test.ts`
- `src/server/services/bot/buildBotContext.ts`
- `src/server/services/bot/platforms/const.ts`
- `src/server/services/bot/replyTemplate.ts`

## Key Files

| File                                                      | Symbols                                                                          |
| --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `src/server/services/bot/AgentBridgeService.ts`           | getActiveOperationId, hooks.handler, threadId, threadId, event, ...              |
| `src/server/services/bot/BotMessageRouter.ts`             | handleSenderRejected, passGatesOrNotify, handler, author, context, ...           |
| `src/server/services/bot/__tests__/replyTemplate.test.ts` | overrides, makeParams                                                            |
| `src/server/services/bot/buildBotContext.ts`              | buildBotContext, params, BuildBotContextParams                                   |
| `src/server/services/bot/platforms/const.ts`              | WatchKeywordEntry, normalizeBotReplyLocale, params, params, shouldHandleDm, ...  |
| `src/server/services/bot/replyTemplate.ts`                | lng, renderApproveSuccess, errorMessage, renderAgentError, getSystemStrings, ... |

## Connected Communities

- **services/bot +4 dirs** (12 cross-edges)
- **services/bot · push** (4 cross-edges)
- **services/bot · deletePairingRequest** (3 cross-edges)
- **services/agentRuntime +8 dirs** (3 cross-edges)
- **bot/platforms · parseIdList** (2 cross-edges)
- **server/services · submitBotFeedback** (1 cross-edges)
- **services/bot · formatToolCall** (1 cross-edges)
- **bot/platforms +8 dirs** (1 cross-edges)
- **services/bot · createOrGetPairingRequest** (1 cross-edges)
- **bot/platforms · findFirstMatchingKeyword** (1 cross-edges)
- **chat/agents +4 dirs** (1 cross-edges)
- **services/bot · validateAccessSettings** (1 cross-edges)
- **server/services · invalidateBotAfterUpdate** (1 cross-edges)

## How to Explore

```
get_communities with id: "community-4341"
smart_context with task: "understand services/bot · registerHandlers", format: "gcx"
```

_`format: "gcx"` returns the [GCX1 compact wire format](../../docs/wire-format.md) — round-trippable, \~27% fewer tokens than JSON. Drop it for JSON output; agents using `@gortex/wire` or the Go `github.com/gortexhq/gcx-go` package decode either._
