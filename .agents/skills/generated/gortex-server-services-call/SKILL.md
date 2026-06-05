---
name: gortex-server-services-call
description: 'Work in the server/services · call area — 138 symbols across 5 files (89% cohesion)'
---

# server/services · call

138 symbols | 5 files | 89% cohesion

## When to Use

Use this skill when working on files in:

- `src/server/services/bot/platforms/slack/api.ts`
- `src/server/services/bot/platforms/slack/client.ts`
- `src/server/services/bot/platforms/slack/sendAttachments.ts`
- `src/server/services/messenger/platforms/slack/binder.ts`
- `src/server/services/messenger/types.ts`

## Key Files

| File                                                         | Symbols                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `src/server/services/bot/platforms/slack/api.ts`             | responseUrl, threadTs, truncateText, getHistory, text, ...                     |
| `src/server/services/bot/platforms/slack/client.ts`          | api, message, extractFiles, message, content, ...                              |
| `src/server/services/bot/platforms/slack/sendAttachments.ts` | fallbackFilename, sendSlackAttachments, api, loadAttachmentBuffer, params, ... |
| `src/server/services/messenger/platforms/slack/binder.ts`    | text, buildVerifyImUrl, replyPrivately, acknowledgeCallback, action, ...       |
| `src/server/services/messenger/types.ts`                     | UnlinkedMessageContext                                                         |

## Connected Communities

- **services/bot +5 dirs** (1 cross-edges)

## How to Explore

```
get_communities with id: "community-4443"
smart_context with task: "understand server/services · call", format: "gcx"
```

_`format: "gcx"` returns the [GCX1 compact wire format](../../docs/wire-format.md) — round-trippable, \~27% fewer tokens than JSON. Drop it for JSON output; agents using `@gortex/wire` or the Go `github.com/gortexhq/gcx-go` package decode either._
