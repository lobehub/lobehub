# Custom Webhook channel — protocol notes

User-facing format reference: `docs/usage/channels/webhook.mdx` (zh-CN: `webhook.zh-CN.mdx`).
Schemas live in `protocol.ts`; keep the docs, the schemas and `protocol.test.ts` in step.

## Shape

- Platform id `webhook`, connection mode `webhook` (stateless, serverless-safe).
- `applicationId` is the developer-chosen **Bot ID** (`BOT_ID_PATTERN`: 3–64 of `[A-Za-z0-9_-]`, never UUID-shaped).
- Credentials: `callbackUrl` (shown in the clear) and `signingSecret` (password, ≥ 32 chars).

## Inbound

- `POST /api/agent/webhooks/custom/:botId` (`router-hono/agent/handlers/customBotWebhook.ts`).
  `:botId` is the Bot ID, or the provider row UUID (`/api/v1/bots/{id}`), resolved to the Bot ID.
  The generic `/api/agent/webhooks/webhook/:appId` route reaches the same adapter.
- Signature: the developer-webhook scheme from R2 (`developerWebhook/signature.ts`):
  `X-LobeHub-Signature: v1=<hex HMAC-SHA256(secret, "<ts>.<raw body>")>`, `X-LobeHub-Timestamp`.
  ±300 s window; several space-separated signatures are accepted (rotation).
- Body ≤ 256 KB. `type: "ping"` → 200 without dispatch; `type: "message"` → Chat SDK `processMessage`.
- Thread id: `webhook:<direct|group>:<uri(conversationId)>[:<uri(threadId)>]`. `isDM` = direct;
  `isMention` = `isDirect || mentioned`.
- Attachments carry URLs; `client.extractFiles` downloads them through `fetchCappedBuffer`
  (SSRF-guarded, pinned DNS, 20 MB cap). A failed download drops only that attachment.

## Outbound

- Every reply is a signed POST to `callbackUrl` through `developerWebhook/send.ts`
  (`postSignedWebhook`: `ssrfSafeFetch`, no redirects, 10 s timeout) — the same sender developer
  webhook deliveries use.
- Events: `bot.message.created`, `bot.message.updated`, `bot.ping` (test connection).
- Retries (`callback.ts`): 3 attempts in-process (0.5 s, 2 s) on network error / timeout / 5xx /
  408 / 429, same event id. Other statuses are final. A final failure throws
  `BotWebhookCallbackError`, so the reply path reports it instead of dropping it silently.
- `supportsMessageEdit: false`: no per-step progress edits; only the final reply is posted.
- `lobe-message` tool: `sendMessage` only (`service.ts`); everything else is listed in
  `PLATFORM_UNSUPPORTED_MESSAGE_APIS.webhook`, so the model is never offered an operation that can
  only fail.
