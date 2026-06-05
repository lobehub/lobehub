---
name: gortex-platforms-telegram-call
description: 'Work in the platforms/telegram · call area — 153 symbols across 3 files (94% cohesion)'
---

# platforms/telegram · call

153 symbols | 3 files | 94% cohesion

## When to Use

Use this skill when working on files in:

- `src/server/services/bot/platforms/telegram/api.ts`
- `src/server/services/bot/platforms/telegram/client.ts`
- `src/server/services/bot/platforms/telegram/sendAttachments.ts`

## Key Files

| File                                                            | Symbols                                                                                      |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/server/services/bot/platforms/telegram/api.ts`             | deleteMessage, isParseEntitiesError, chatId, editMessageWithCallbackKeyboard, messageId, ... |
| `src/server/services/bot/platforms/telegram/client.ts`          | type, parseMessageId, formatReply, context, TelegramWebhookClient, ...                       |
| `src/server/services/bot/platforms/telegram/sendAttachments.ts` | dispatch, source, attachments, att, caption, ...                                             |

## Connected Communities

- **platforms/telegram +60 dirs** (3 cross-edges)
- **src/transformation +60 dirs** (1 cross-edges)

## How to Explore

```
get_communities with id: "community-4460"
smart_context with task: "understand platforms/telegram · call", format: "gcx"
```

_`format: "gcx"` returns the [GCX1 compact wire format](../../docs/wire-format.md) — round-trippable, \~27% fewer tokens than JSON. Drop it for JSON output; agents using `@gortex/wire` or the Go `github.com/gortexhq/gcx-go` package decode either._
