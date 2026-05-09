# LINE Messaging API – Bot Integration Notes

Quick orientation map for engineers working on the LINE adapter.
Authoritative documentation:

- Messaging API overview: <https://developers.line.biz/en/docs/messaging-api/>
- Webhook reference: <https://developers.line.biz/en/reference/messaging-api/#webhooks>
- Get bot info: <https://developers.line.biz/en/reference/messaging-api/#get-bot-info>
- Send push message: <https://developers.line.biz/en/reference/messaging-api/#send-push-message>
- Display loading indicator: <https://developers.line.biz/en/reference/messaging-api/#display-a-loading-indicator>
- Get content: <https://developers.line.biz/en/reference/messaging-api/#get-content>

## Credentials

| Field                | Source                                                      | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `applicationId`      | `GET https://api.line.me/v2/bot/info` → `userId`            | The bot's destination user ID (`U` + 32 hex chars), also the `destination` field on every webhook payload. **The LINE Developers Console UI does not surface this value** — the "Your user ID" on the channel's Basic settings tab is the **operator's own** LINE user ID, not the bot's. Operators must call the API (or rely on `validateCredentials` echoing the correct value back in the `Channel access token belongs to bot Uxxx` error). |
| `channelAccessToken` | LINE Developers Console → Messaging API tab → "Issue token" | Long-lived. Bearer header for every API call.                                                                                                                                                                                                                                                                                                                                                                                                    |
| `channelSecret`      | LINE Developers Console → Basic settings tab                | Used to validate `X-Line-Signature` on every inbound POST. **Required**, no fallback.                                                                                                                                                                                                                                                                                                                                                            |

## Webhook lifecycle

1. **No GET handshake.** LINE Developers Console verifies the webhook URL by
   sending a `POST` with `{ destination, events: [] }` when the operator
   clicks the "Verify" button. We accept that ping (200 OK) once the
   signature checks out — the empty `events` array is what makes it harmless.
2. **POST notification** – LINE sends a JSON body with `destination` and one
   or more `events[]`. We only handle `event.type === "message"`.
3. **Signature validation** – every POST must carry an `X-Line-Signature`
   header equal to **base64**(HMAC-SHA256(rawBody, channelSecret)). Note the
   base64 encoding (WhatsApp uses hex with `sha256=` prefix). Mismatched or
   missing signatures get a 401 and are dropped.

## Payload shape (inbound)

```jsonc
{
  "destination": "U<bot-user-id>",
  "events": [
    {
      "type": "message",
      "mode": "active",
      "timestamp": 1700000000000,
      "source": { "type": "user", "userId": "Uabc..." },
      "webhookEventId": "01H...",
      "deliveryContext": { "isRedelivery": false },
      "replyToken": "...",
      "message": { "type": "text", "id": "1000", "text": "hi bot" },
    },
  ],
}
```

`source.type` ∈ `user` / `group` / `room`. We encode the platform thread id
as `line:<type>:<sourceId>` where `sourceId` is `userId` / `groupId` /
`roomId` respectively. The thread id determines whether typing indicators
are available (only `user`).

Media messages (`image`, `video`, `audio`, `file`) carry only `id` —
no caption, no inline mime. `file` additionally carries `fileName` and
`fileSize`. Bytes are fetched on demand by the platform client's
`extractFiles` via `GET <data-host>/v2/bot/message/<id>/content` with the
bearer header.

`replyToken` is **single-use and expires in \~60 seconds**. We always use
the push API instead because the agent's response can take longer than
that. Push messages count against the channel's monthly quota for paid
plans; for the free Developer Trial it's effectively unlimited.

## Outbound

`POST /v2/bot/message/push` with

```json
{
  "messages": [{ "type": "text", "text": "…" }],
  "to": "<wa_id>"
}
```

`to` is the recipient's `userId` / `groupId` / `roomId`, decoded from the
platform thread id.

## Capabilities

- **No edit / no delete** – Messaging API has no edit endpoint. The platform
  definition sets `supportsMessageEdit: false`; the bridge therefore skips
  per-step progress edits and only emits the final reply.
- **Markdown** – LINE renders text as plain text only. The platform client's
  `formatMarkdown` runs `stripMarkdown` to strip emphasis / heading / list
  markers before sending.
- **Typing indicator** – `POST /v2/bot/chat/loading/start` with
  `{ chatId, loadingSeconds }`. Only valid for 1:1 user chats — `group`
  and `room` threads silently no-op.
- **Reactions** – LINE does not let bots send reactions; the messenger's
  reaction methods are no-ops.

## Operator-facing setup

Webhook URL must be configured manually in the LINE Developers Console
(`Messaging API → Webhook settings → Webhook URL`). After pasting it the
operator presses "Verify" — that fires a signed POST with `events: []`
to our endpoint. Operator must also enable "Use webhook" and disable the
LINE Official Account Manager "Auto-reply messages" / "Greeting messages"
to prevent the platform from competing with our bot's responses.
