---
name: gortex-chat-adapter-feishu-src-3-dirs
description: 'Work in the chat-adapter-feishu/src +3 dirs area — 177 symbols across 8 files (93% cohesion)'
---

# chat-adapter-feishu/src +3 dirs

177 symbols | 8 files | 93% cohesion

## When to Use

Use this skill when working on files in:

- `packages/chat-adapter-feishu/src/adapter.test.ts`
- `packages/chat-adapter-feishu/src/adapter.ts`
- `packages/chat-adapter-feishu/src/api.ts`
- `packages/chat-adapter-feishu/src/crypto.ts`
- `packages/chat-adapter-feishu/src/types.ts`
- `src/server/services/bot/platforms/feishu/client.ts`
- `src/server/services/bot/platforms/line/client.ts`
- `src/server/services/bot/platforms/wechat/client.ts`

## Key Files

| File                                                 | Symbols                                                              |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| `packages/chat-adapter-feishu/src/adapter.test.ts`   | overrides, sender, makeRequest, body, makeLarkMessage, ...           |
| `packages/chat-adapter-feishu/src/adapter.ts`        | toEmojiType, config, LarkAdapter, decodeThreadId, parseRawEvent, ... |
| `packages/chat-adapter-feishu/src/api.ts`            | reactionId, emojiType, getMessage, sendMessage, text, ...            |
| `packages/chat-adapter-feishu/src/crypto.ts`         | decryptLarkEvent, encryptKey, encrypted                              |
| `packages/chat-adapter-feishu/src/types.ts`          | LarkThreadId, LarkRawMessage, LarkMessageBody                        |
| `src/server/services/bot/platforms/feishu/client.ts` | message, api, api, feishuExtractFiles, extractFiles, ...             |
| `src/server/services/bot/platforms/line/client.ts`   | credentials, \_settings, validateCredentials, applicationId          |
| `src/server/services/bot/platforms/wechat/client.ts` | extractFiles, message                                                |

## How to Explore

```
get_communities with id: "community-642"
smart_context with task: "understand chat-adapter-feishu/src +3 dirs", format: "gcx"
```

_`format: "gcx"` returns the [GCX1 compact wire format](../../docs/wire-format.md) — round-trippable, \~27% fewer tokens than JSON. Drop it for JSON output; agents using `@gortex/wire` or the Go `github.com/gortexhq/gcx-go` package decode either._
