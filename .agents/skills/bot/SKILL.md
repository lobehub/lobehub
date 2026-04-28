---
name: bot
description: 'Bot platform architecture (Discord, Slack, Telegram, Feishu/Lark, QQ, WeChat). Use when working on inbound webhooks, Chat SDK message routing, agent execution from chat platforms, queue-mode callbacks, gateway lifecycle (websocket/polling), bot provider CRUD/credentials, or platform-specific clients/adapters/schemas. Triggers on bot, channel, webhook, mention, Chat SDK, agent bot provider, gateway, bot-callback, qstash bot.'
---

# Bot System

> **Last updated: 2026-04-08.** Implementation evolves quickly — this doc is a map, not the source of truth. Always read the key files below to verify behavior, especially per-platform quirks. Update this doc when the architecture changes.

LobeChat agents can answer inside external chat platforms. Inbound messages flow through the Chat SDK (`chat` npm package), get routed to the right agent by `(platform, applicationId)`, executed via `AiAgentService`, and replied back through a per-platform `PlatformClient`. There are **two execution modes** (in-memory vs queue/QStash) and **three connection modes** (`webhook`, `websocket`, `polling`).

## Supported Platforms

| Platform | id         | Default mode                    | Markdown          | Edit   | Notes                                                                                  |
| -------- | ---------- | ------------------------------- | ----------------- | ------ | -------------------------------------------------------------------------------------- |
| Discord  | `discord`  | `websocket`                     | yes               | yes    | Persistent gateway via Chat SDK adapter; reaction-thread quirks; native slash commands |
| Slack    | `slack`    | `websocket` (Socket Mode)       | yes (mrkdwn)      | yes    | Multi-mode — user can pick `webhook` per provider                                      |
| Telegram | `telegram` | `webhook`                       | yes (HTML)        | yes    | `setMyCommands` menu via `registerBotCommands`                                         |
| Feishu   | `feishu`   | `websocket` (Lark SDK WSClient) | **no** (stripped) | yes    | Multi-mode; shared client with Lark                                                    |
| Lark     | `lark`     | `websocket`                     | **no**            | yes    | Same client/schema as Feishu, different domain                                         |
| QQ       | `qq`       | `websocket`                     | **no**            | **no** | All replies are final-only                                                             |
| WeChat   | `wechat`   | `polling` (iLink long-poll)     | **no**            | **no** | 10-minute gateway window                                                               |

`supportsMarkdown=false` ⇒ outbound markdown is stripped to plain text via `stripMarkdown` and the AI is told not to use markdown. `supportsMessageEdit=false` ⇒ no progress edits — only the final reply is sent.

**Multi-mode connection** — Slack/Feishu/Lark/QQ ship as websocket but support `webhook` per-provider via `settings.connectionMode`. The runtime always merges schema defaults into stored settings before resolving the mode (`resolveBotProviderConfig` / `resolveConnectionMode` in `platforms/utils.ts`), so the schema's `field.default` is the source of truth — set it correctly when adding a new multi-mode platform.

## Inbound Flow (one webhook → reply)

```
Platform server
   │  POST /api/agent/webhooks/[platform]/[appId]
   ▼
route.ts ── catch-all `[[...appId]]` route
   │
   ▼
BotMessageRouter (singleton)
   │  • lazy-loads bot per `platform:applicationId`
   │  • merges schema defaults + provider.settings (mergeWithDefaults)
   │  • builds Chat SDK Chat<any> with createIoRedisState (if Redis available)
   │  • registerHandlers: onNewMention / onSubscribedMessage / onNewMessage(/.dm)
   │  • registerCommands: /new (reset topic), /stop (interrupt)
   │
   ▼
chatBot.webhooks[platform](req)   ← Chat SDK parses → fires events
   │
   ▼
AgentBridgeService.handleMention / handleSubscribedMessage
   │  • activeThreads guard (no duplicate runs per thread)
   │  • adds 👀 reaction (eyes), startTyping
   │  • merges debounced/queued skipped messages (mergeSkippedMessages)
   │  • extractFiles (buffer → fetchData → url)
   │  • formatPrompt (sanitize mention + speaker tag + referenced_message)
   │
   ├── In-memory mode ──► AiAgentService.execAgent({ stepCallbacks })
   │       → onAfterStep edits progress message live
   │       → onComplete edits final reply, splits via splitMessage(charLimit)
   │
   └── Queue mode (isQueueAgentRuntimeEnabled) ──► execAgent({ stepWebhook, completionWebhook, webhookDelivery: 'qstash' })
           → returns immediately, callbacks land at /api/agent/webhooks/bot-callback
```

The router caches loaded bots in memory. Cache is **invalidated** by `BotMessageRouter.invalidateBot(platform, appId)` whenever the TRPC `update`/`delete` mutations run, so new credentials/settings take effect on the next webhook.

## Execution Modes

### In-memory (default)

`AgentBridgeService.executeWithInMemoryCallbacks` wraps `execAgent` with `stepCallbacks`. Lives in one process — Promise-based wait, 30-min timeout, edits the same `progressMessage` after every step. Topic title is summarized inline via `SystemAgentService`.

### Queue (`isQueueAgentRuntimeEnabled`)

`AgentBridgeService.executeWithWebhooks`:

1. Posts the `renderStart` placeholder, captures `progressMessageId`.
2. Calls `execAgent` with `stepWebhook` and `completionWebhook` pointing at `${INTERNAL_APP_URL ?? APP_URL}/api/agent/webhooks/bot-callback`, plus `webhookDelivery: 'qstash'`.
3. Returns immediately; the bridge `finally` block keeps the active-thread marker held until the `completion` callback fires.

`/api/agent/webhooks/bot-callback/route.ts` verifies the QStash signature and hands off to `BotCallbackService.handleCallback`:

- `type: 'step'` → `handleStep` re-renders `renderStepProgress`, edits `progressMessageId` (skipped if `displayToolCalls=false` or platform `supportsMessageEdit=false`).
- `type: 'completion'` → `handleCompletion` writes the final reply (or error/interrupted message), removes the 👀 reaction, clears active-thread tracker, fires async `summarizeTopicTitle`.

`BotCallbackService.createMessenger` reloads provider + credentials from DB and rebuilds a `PlatformClient` per call (no in-memory state).

## Commands

Defined in `BotMessageRouter.buildCommands` and registered via two paths:

- **Native slash commands** (Slack/Discord): `bot.onSlashCommand('/<name>', ...)`
- **Text-based fallback** (Telegram/Feishu/QQ/Lark/WeChat): `bot.onNewMessage(/^\/(new|stop)(\s|$|@)/, ...)` plus a per-mention `tryDispatch` so commands work even before subscribe.

Built-in commands:

- `/new` — clears `topicId` in thread state, next message starts a fresh topic.
- `/stop` — interrupts the active execution (calls `AiAgentService.interruptTask` if `operationId` is known; otherwise queues a deferred stop via `requestStop`/`pendingStopThreads`, also aborts the startup phase via `startupControllers`).

To add a command, append to `buildCommands` — it auto-registers everywhere; on Telegram it also surfaces in the `/` menu via `client.registerBotCommands` → `setMyCommands`.

## Active-thread State (statics on `AgentBridgeService`)

- `activeThreads: Set<threadId>` — prevents duplicate runs per thread (must guard before stale-topic check, otherwise concurrent messages can drop).
- `activeOperations: Map<threadId, operationId>` — needed by `/stop` once `execAgent` returns.
- `startupControllers: Map<threadId, AbortController>` — cancels pre-`operationId` work (topic/tool prep).
- `pendingStopThreads: Set<threadId>` — `/stop` arrived before `operationId` existed; consumed once available.

In **queue mode**, the bridge `finally` skips cleanup so the marker persists until `BotCallbackService.handleCompletion` calls `clearActiveThread`.

## Topic Lifecycle in Threads

- `handleMention` always treats the message as the start of a new conversation.
- `handleSubscribedMessage` reads `topicId` from `thread.state`. If the topic is stale (`> 4 hours` since `updatedAt`), state is cleared and it retries as a fresh mention.
- If `execAgent` fails with a Postgres FK violation on `topic_id` (cached topic was deleted), the bridge clears state and retries as a mention.
- `subscribe()` is gated by `client.shouldSubscribe(threadId)` — Discord top-level channels return `false` so we don't follow up there.

## Attachments

`AgentBridgeService.extractFiles` resolves attachments in priority order:

1. `att.buffer` — already downloaded by the adapter (WeChat/Feishu inbound).
2. `att.fetchData()` — adapter-provided lazy download with auth (Telegram, Slack, Feishu history). **Required** when URLs are token-protected — naive `fetch(url)` later in `ingestAttachment.ts` has no credentials.
3. `att.url` — public CDN fallback (Discord, public QQ).

`inferMimeType` / `inferName` patch Telegram-style `photo` payloads (no `mimeType`/`name` from Bot API → defaults to `image/jpeg`) so vision models actually see them. Quoted-message attachments are also pulled from `raw.referenced_message.attachments` (Discord).

## Concurrency

`settings.concurrency` is `'queue'` or `'debounce'`:

- `debounce` → Chat SDK debounces inbound messages by `debounceMs`; `mergeSkippedMessages` joins skipped texts/attachments into the current message before handing to the agent.
- `queue` → Chat SDK serializes per-thread; the bridge's own `activeThreads` set is still required because in queue mode the SDK lock releases before the agent finishes.

## Gateway (persistent platforms)

Webhook platforms run fine in serverless functions. Persistent platforms (`websocket`, `polling`) need a long-running listener — that's the **gateway**.

**`GatewayService.startClient(platform, appId, userId)`** (`src/server/services/gateway/index.ts`):

- On Vercel + persistent mode → `BotConnectQueue.push` (Redis hash) and mark runtime status `queued`. The cron picks it up.
- On Vercel + webhook mode → start the client inline (one HTTP call).
- Off-Vercel → `GatewayManager` singleton holds long-lived clients in process.

**`GET /api/agent/gateway/route.ts`** (cron, `Bearer ${CRON_SECRET}`):

- Iterates registered platforms and starts every enabled persistent provider with `durationMs = 10min`, then in `after(...)` polls `BotConnectQueue` every 30s for new connect requests, until the window expires.
- `getEffectiveConnectionMode(platform, settings)` is the only place that resolves per-provider mode — respect it everywhere.

**`POST /api/agent/gateway/start/route.ts`** is the non-Vercel `ensureRunning` entry point (`Bearer ${KEY_VAULTS_SECRET}`).

**Runtime status** is stored in Redis at `bot:runtime-status:platform:appId` with TTL ≈ `durationMs + 60s`. States: `starting | connected | disconnected | failed | queued`. Updated by each `PlatformClient.start/stop` and by the gateway service.

## Platform Definitions

Each platform exposes a `PlatformDefinition` registered in `platforms/index.ts`:

```ts
{
  id: 'discord',
  name: 'Discord',
  connectionMode: 'websocket',          // recommended default
  schema: FieldSchema[],                 // applicationId + credentials + settings
  clientFactory: new DiscordClientFactory(),
  supportsMarkdown?: boolean,            // default true
  supportsMessageEdit?: boolean,         // default true
  documentation?: { portalUrl, setupGuideUrl },
}
```

`schema` drives both server validation (`mergeWithDefaults`, `extractDefaults`) **and** the auto-generated UI form. Top-level keys `applicationId` / `credentials` / `settings` map to DB columns. Common settings fields live in `platforms/const.ts` (`displayToolCallsField`, `serverIdField`, `userIdField`).

Each platform implements `PlatformClient` (see `platforms/types.ts`):

- Lifecycle: `start(opts?)`, `stop()`
- Inbound: `createAdapter()` → Chat SDK adapter map
- Outbound: `getMessenger(platformThreadId)` → `{ createMessage, editMessage, removeReaction, triggerTyping, updateThreadName? }`
- Formatting: `formatMarkdown?`, `formatReply?` (usage-stats footer when `showUsageStats`)
- Helpers: `extractChatId`, `parseMessageId`, `sanitizeUserInput`, `shouldSubscribe`, `resolveReactionThreadId`
- Optional patches: `applyChatPatches(chatBot)` (Discord uses this for `forwardedInteractions` + `threadRecovery`)
- Optional menu: `registerBotCommands(commands)` (Telegram `setMyCommands`)

`ClientFactory.validateCredentials` is called from the TRPC `testConnection` mutation — implement it to hit the platform API and return useful per-field errors.

## Database

**Schema** (`packages/database/src/schemas/agentBotProvider.ts`):

```ts
agent_bot_providers (
  id uuid pk,
  agent_id text fk → agents.id (cascade),
  user_id text fk → users.id (cascade),
  platform varchar(50),                  // 'discord' | 'slack' | …
  application_id varchar(255),
  credentials text,                      // KeyVaults-encrypted JSON
  settings jsonb default '{}',
  enabled boolean default true,
  …timestamps
)
unique (platform, application_id)
```

**Model** (`packages/database/src/models/agentBotProvider.ts`):

- User-scoped: `create / update / delete / query / findById / findByAgentId / findEnabledByApplicationId`. Credentials are encrypted/decrypted via the injected `KeyVaultsGateKeeper`.
- Static (system-wide): `findByPlatformAndAppId`, `findEnabledByPlatform` — used by webhook routing & gateway sync, since they don't have a user context yet.

**TRPC router** (`src/server/routers/lambda/agentBotProvider.ts`):

| Procedure                                    | Notes                                                                                       |              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------ |
| `listPlatforms`                              | Returns `SerializedPlatformDefinition[]` (no `clientFactory`)                               |              |
| `create` / `update` / `delete`               | Calls `BotMessageRouter.invalidateBot` + `GatewayService.stopClient` so changes take effect |              |
| `list` / `getByAgentId` / `getRuntimeStatus` | Decorate rows with Redis runtime status                                                     |              |
| `connectBot`                                 | Returns \`{ status: 'started'                                                               | 'queued' }\` |
| `testConnection`                             | Calls `clientFactory.validateCredentials`                                                   |              |
| `wechatGetQrCode` / `wechatPollQrStatus`     | iLink onboarding flow                                                                       |              |

Client service: `src/services/agentBotProvider.ts`. Store actions: `src/store/agent/slices/bot/action.ts`. UI: `src/routes/(main)/agent/channel/{list,detail}` — settings form is auto-generated from each platform's `schema`.

## Reply Templates

`src/server/services/bot/replyTemplate.ts` exports `renderStart`, `renderStepProgress`, `renderFinalReply`, `renderError`, `renderStopped`, `splitMessage`. Step progress carries elapsed time, last LLM content, last tools, totals; final reply uses `client.formatMarkdown` then `client.formatReply` (which optionally appends `formatUsageStats`). `splitMessage(text, charLimit)` chunks at paragraph → line → hard cut.

`src/server/services/bot/ackPhrases/` provides randomized ack phrases.

## Key Files

```plaintext
Webhook routes:
  src/app/(backend)/api/agent/webhooks/[platform]/[[...appId]]/route.ts  — inbound catch-all
  src/app/(backend)/api/agent/webhooks/bot-callback/route.ts             — qstash bot callback
  src/app/(backend)/api/agent/gateway/route.ts                           — cron gateway (10min window)
  src/app/(backend)/api/agent/gateway/start/route.ts                     — non-Vercel ensureRunning

Bot service:
  src/server/services/bot/index.ts                          — barrel
  src/server/services/bot/BotMessageRouter.ts               — lazy bot loading + handler registration + commands
  src/server/services/bot/AgentBridgeService.ts             — Chat SDK ↔ AiAgentService bridge, both exec modes
  src/server/services/bot/BotCallbackService.ts             — qstash callback handler
  src/server/services/bot/formatPrompt.ts                   — speaker tag + referenced_message + sanitize
  src/server/services/bot/replyTemplate.ts                  — render*/splitMessage
  src/server/services/bot/ackPhrases/                       — randomized acks
  src/server/services/bot/__tests__/                        — unit tests for the above

Platform abstraction:
  src/server/services/bot/platforms/index.ts                — registry singleton + exports
  src/server/services/bot/platforms/types.ts                — PlatformClient/Definition/FieldSchema/ClientFactory
  src/server/services/bot/platforms/registry.ts             — PlatformRegistry class
  src/server/services/bot/platforms/utils.ts                — mergeWithDefaults, getEffectiveConnectionMode, formatUsageStats, runtimeKey
  src/server/services/bot/platforms/const.ts                — shared FieldSchema fragments (displayToolCalls, serverId, userId)
  src/server/services/bot/platforms/stripMarkdown.ts        — used by no-markdown platforms

Per-platform (each ships definition.ts, schema.ts, client.ts, const.ts, protocol-spec.md):
  src/server/services/bot/platforms/discord/                — websocket gateway + chat patches
  src/server/services/bot/platforms/slack/                  — multi-mode (Socket Mode / webhook), markdownToMrkdwn
  src/server/services/bot/platforms/telegram/               — webhook, markdownToHTML, registerBotCommands
  src/server/services/bot/platforms/feishu/                 — feishu + lark share client/schema (definitions/{feishu,lark,shared}.ts)
  src/server/services/bot/platforms/qq/                     — websocket, no markdown, no edit
  src/server/services/bot/platforms/wechat/                 — long-poll, no markdown, no edit

Gateway:
  src/server/services/gateway/index.ts                      — GatewayService (Vercel-aware startClient/stopClient)
  src/server/services/gateway/GatewayManager.ts             — long-running client registry (non-Vercel)
  src/server/services/gateway/botConnectQueue.ts            — Redis hash queue with TTL
  src/server/services/gateway/runtimeStatus.ts              — Redis bot:runtime-status keys

Database:
  packages/database/src/schemas/agentBotProvider.ts         — agent_bot_providers table
  packages/database/src/models/agentBotProvider.ts          — encrypted CRUD + system-wide finders

TRPC + client:
  src/server/routers/lambda/agentBotProvider.ts             — TRPC router
  src/services/agentBotProvider.ts                          — client wrapper
  src/store/agent/slices/bot/action.ts                      — Zustand actions

UI:
  src/routes/(main)/agent/channel/list.tsx                  — channel list
  src/routes/(main)/agent/channel/detail/                   — auto-generated form (Header/Body/Footer)
  src/routes/(main)/agent/channel/const.ts                  — platform icons

Types & runtime status:
  src/types/botRuntimeStatus.ts                             — BOT_RUNTIME_STATUSES enum + snapshot type
```

## Adding a New Platform

1. Create `src/server/services/bot/platforms/<id>/`:
   - `definition.ts` — `PlatformDefinition` registered in `platforms/index.ts`
   - `schema.ts` — `FieldSchema[]` (`applicationId` + `credentials` + `settings`); reuse fragments from `../const.ts`
   - `client.ts` — `class XClientFactory extends ClientFactory` returning a `PlatformClient` (lifecycle + adapter + messenger + helpers)
   - `const.ts` — `DEFAULT_X_CONNECTION_MODE`, history limits, etc.
   - `protocol-spec.md` — protocol notes (every existing platform has one)
2. Pick the right `connectionMode` — webhook is much simpler if the platform supports it.
3. If the platform can't render markdown, set `supportsMarkdown: false` and implement `formatMarkdown` via `stripMarkdown`.
4. If it can't edit messages, set `supportsMessageEdit: false` — `BotCallbackService` will skip step edits and only send the final reply.
5. Implement `validateCredentials` so the UI's "Test connection" button gives useful errors.
6. Add the platform icon in `src/routes/(main)/agent/channel/const.ts` and register the platform in `src/server/services/bot/platforms/index.ts`.
7. Add i18n keys under `channel.*` in `src/locales/default/setting.ts` (or wherever the channel namespace lives) — the schema's `label`/`description`/`placeholder`/`enumLabels` are i18n keys.
