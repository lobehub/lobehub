# DingTalk Channel Design

Date: 2026-04-03
Status: Approved for implementation planning
Scope: LobeHub built-in DingTalk webhook MVP for enterprise internal app bots

## Summary

Add a built-in `dingtalk` bot platform to LobeHub's existing channel architecture so an agent can receive and reply to DingTalk enterprise bot messages through webhook callbacks.

This design intentionally targets a narrow MVP:

- DingTalk enterprise internal app bot only
- Webhook-based integration only
- Private chat support
- Group chat support
- Group replies only when the bot is explicitly mentioned
- Shared thread per group
- Text inbound only
- Text and Markdown outbound replies
- Manual webhook setup in DingTalk console using a URL shown by LobeHub

This design does not include DingTalk Stream mode, AI cards, media/file handling, multi-bot account routing inside one provider record, learning/feedback loops, quoted reply recovery, or group/user allowlist policies.

## Background

LobeHub already has a reusable bot platform architecture:

- Persistent and webhook platform definitions are registered in `src/server/services/bot/platforms/`
- Runtime bindings are stored in `agent_bot_providers`
- The unified webhook entry lives at `src/app/(backend)/api/agent/webhooks/[platform]/[[...appId]]/route.ts`
- Webhook dispatch and bot lifecycle are handled by `BotMessageRouter`
- Agent execution and reply rendering already flow through `AgentBridgeService`
- The channel configuration page is generated from platform field schemas

Because DingTalk webhook integration matches the current webhook platform model, the least risky implementation is to add a native `dingtalk` platform within the existing system instead of introducing a separate gateway process or external bridge.

## Goals

- Allow a user to connect a DingTalk enterprise internal app bot to a LobeHub agent
- Reuse the existing LobeHub bot platform architecture as much as possible
- Keep the first implementation small and deterministic
- Support a production-safe group behavior: respond only when explicitly mentioned
- Preserve a clean extension path for future DingTalk features such as cards, policies, and richer message types

## Non-Goals

- DingTalk Stream mode or long-lived websocket clients
- Auto-registering or auto-updating DingTalk webhook callbacks from LobeHub
- Media, file, voice, or image message handling
- Interactive cards or streaming card updates
- Fine-grained DM/group allowlists and policy controls
- Multiple DingTalk accounts under one channel config record
- Shared logic extraction into a standalone `chat-adapter-dingtalk` package during MVP

## User Experience

### Agent owner setup flow

1. Open agent channel settings in LobeHub
2. Select `DingTalk`
3. Fill in required credentials and settings
4. Save the configuration
5. Copy the webhook URL displayed by LobeHub
6. Paste the webhook URL into DingTalk's bot event subscription configuration
7. Use `Test Connection` to verify credentials
8. Send a private message or mention the bot in a group to validate the flow

### End-user behavior

- In private chat, every supported text message triggers the agent
- In group chat, only messages that explicitly mention the bot trigger the agent
- All users in the same group share one conversation thread with the agent
- Markdown replies use DingTalk's supported formatting subset; unsupported formatting degrades safely to plain text

## Product Decisions

The following decisions are fixed for this MVP:

- Platform type: webhook
- DingTalk app type: enterprise internal app bot
- Group trigger mode: mention required
- Group context model: one shared thread per group
- Setup mode: manual webhook configuration in DingTalk console
- Outbound reply modes: `markdown` and `text`
- Advanced settings included in MVP: `messageType`, `charLimit`, `showUsageStats`
- Advanced settings postponed: `dmPolicy`, `groupPolicy`, allowlists, cards, media, and learning features

## Architecture

### Recommended approach

Add a first-party `dingtalk` platform under the existing LobeHub bot platform registry.

This keeps DingTalk aligned with current implementations such as Telegram, Slack, and Feishu/Lark:

- platform definition supplies metadata and field schema
- client factory validates credentials and creates a runtime client
- webhook requests enter the shared route and are delegated through `BotMessageRouter`
- inbound DingTalk events are normalized into the existing agent execution flow
- outbound messages use a DingTalk-specific messenger implementation

### New modules

Create a new directory:

`src/server/services/bot/platforms/dingtalk/`

Planned files:

- `definition.ts` — platform metadata and registration entry
- `schema.ts` — channel form schema and defaults
- `client.ts` — `PlatformClient` and `ClientFactory` implementation
- `api.ts` — DingTalk HTTP API wrapper for auth and message sending
- `helpers.ts` — request verification, decrypt/encrypt helpers, mention stripping, message-type guards
- `protocol-spec.md` — implementation notes mirroring other platforms

### Existing integration points

The design reuses these existing boundaries:

- `src/server/services/bot/platforms/index.ts` — register `dingtalk`
- `src/server/services/bot/BotMessageRouter.ts` — load and dispatch the platform bot on demand
- `src/server/services/bot/AgentBridgeService.ts` — execute the agent and render replies
- `src/server/routers/lambda/agentBotProvider.ts` — create/update/test channel configs
- `src/routes/(main)/agent/channel/detail/Body.tsx` — render schema-driven settings UI
- `docs/usage/channels/` — user-facing setup guide

## Configuration Model

### Stored record model

No database schema changes are required.

DingTalk will use the existing `agent_bot_providers` record shape:

- `platform = 'dingtalk'`
- `applicationId` = DingTalk AppKey, used as the webhook routing key
- `credentials` = encrypted DingTalk secrets and validation fields
- `settings` = small MVP settings object

### Credential fields

Required fields for MVP:

- `applicationId` (stores DingTalk AppKey)
- `credentials.clientSecret`
- `credentials.verificationToken`
- `credentials.aesKey`

Notes:

- `applicationId` stores DingTalk AppKey and is the stable route key used in `/api/agent/webhooks/dingtalk/<applicationId>`
- `clientSecret` is used for token exchange and outbound API calls
- `verificationToken` is used to validate inbound webhook authenticity where applicable
- `aesKey` is used when DingTalk encrypts callback payloads

### Settings fields

MVP settings:

- `messageType`: `markdown | text`
- `charLimit`: numeric limit applied before sending outbound replies
- `showUsageStats`: whether to append usage information to the final message

### Deferred settings

These are intentionally excluded from MVP but kept in mind for later phases:

- `dmPolicy`
- `groupPolicy`
- `allowFrom`
- `groupAllowFrom`
- card-related settings
- media and learning settings
- connection tuning settings from Stream-mode designs

## Webhook Model

### URL shape

LobeHub will expose the DingTalk callback URL using the shared route shape:

`/api/agent/webhooks/dingtalk/<applicationId>`

The UI will display the full absolute URL so the user can copy it into DingTalk's event subscription console.

### Setup mode

MVP uses manual webhook registration only.

LobeHub will not attempt to create, update, or remove DingTalk webhook subscriptions automatically during save or test flows.

### Request handling requirements

The DingTalk platform adapter must handle three webhook concerns before handing a message to the agent flow:

- verify the callback origin according to DingTalk's webhook protocol
- decrypt the callback body when encryption is enabled
- answer DingTalk's challenge or acknowledgement handshake format when required

These rules must be implemented against DingTalk's official protocol documentation, not inferred from other platforms.

## Conversation Model

### Thread identity

The DingTalk platform will produce stable thread IDs in a platform-owned namespace.

Recommended format:

- private chat: `dingtalk:dm:<userId>`
- group chat: `dingtalk:group:<conversationId>`

This keeps thread derivation explicit and compatible with the existing `PlatformClient.extractChatId` contract.

### Shared group context

All users in the same DingTalk group share a single LobeHub thread.

This means:

- group context is collective
- a later mention in the same group continues the shared thread
- the implementation does not create per-user subthreads inside one group

### Trigger rules

- private chat: trigger on supported text messages
- group chat: trigger only when the bot is explicitly mentioned
- unsupported messages: ignore or return a clear unsupported-type response, depending on the final adapter ergonomics

## Inbound Message Handling

### Supported inbound scope

MVP only supports textual DingTalk messages.

The adapter must normalize incoming events into a minimal bot message structure containing:

- message ID
- sender ID and display name if available
- chat type: private or group
- conversation ID or chat ID
- plain text body
- mention metadata indicating whether the bot was mentioned

### Mention processing

Group messages must pass two checks:

1. determine whether the bot was actually mentioned using official event fields where possible
2. strip mention artifacts before forwarding the text to the agent

Mention detection must not rely only on display-text string matching if DingTalk provides structured mention metadata.

### Unsupported message types

The adapter will not parse or forward media, file, voice, image, or card-originated messages in MVP.

## Outbound Reply Handling

### Reply modes

Two reply modes are available:

- `markdown` — preferred default
- `text` — safe fallback mode

### Markdown strategy

DingTalk markdown support is expected to be more limited than Slack or Telegram formatting.

The platform implementation should therefore:

- support a conservative markdown subset first
- normalize unsupported markdown into plain text where necessary
- avoid sending formatting that is known to render poorly

### Usage stats

If `showUsageStats` is enabled, usage information may be appended to the final outbound message in a lightweight text form.

The exact formatting should follow the same spirit as other webhook platforms and remain readable in both `markdown` and `text` reply modes.

### Character limit

`charLimit` must be enforced before calling DingTalk send-message APIs.

If the rendered reply exceeds the limit, the implementation should split or truncate according to the existing LobeHub reply-template conventions used by other platforms.

## Runtime Behavior

### Platform type

DingTalk is treated as a webhook platform, not a persistent platform.

This means:

- no dedicated long-lived gateway client is required
- no queue-based connect flow is required for serverless compatibility
- `start()` is primarily a credential validation and runtime-status transition step

### Runtime status expectations

The DingTalk client should follow the same runtime status contract as other platforms:

- `starting` when validating credentials
- `connected` after validation succeeds
- `failed` if validation fails
- `disconnected` when removed or stopped

## Validation and Testing

### Credential validation

`Test Connection` should validate only the DingTalk credentials needed to call the official API and authenticate the app.

It should not register webhooks automatically.

### Automated test scope

The MVP implementation should include tests for:

- platform registration and serialization
- schema default behavior where appropriate
- credential validation failure and success paths
- inbound webhook verification and decryption edge cases
- mention-required behavior in groups
- thread key derivation for private and group chats
- markdown/plain-text reply formatting

### Manual verification checklist

Before implementation is considered complete, verify:

1. DingTalk appears in the channel platform list
2. Saving configuration persists credentials and settings correctly
3. The webhook URL displays correctly in the UI
4. `Test Connection` validates working credentials
5. A private chat text message reaches the agent and receives a reply
6. A group text message without mention does not trigger the agent
7. A group text message with mention triggers the agent in the shared group thread
8. Markdown mode renders acceptably; text mode remains safe and readable

## Risks and Mitigations

### Risk: protocol mismatch with DingTalk webhook security

Mitigation:

- implement verification and decryption only against official DingTalk documentation
- keep helper functions isolated in the DingTalk platform module
- cover challenge and encrypted callback cases in tests

### Risk: markdown rendering inconsistencies

Mitigation:

- keep the supported markdown subset conservative
- preserve `text` mode as a first-class fallback
- add fixture-style tests for markdown normalization

### Risk: incorrect mention detection in groups

Mitigation:

- prefer structured mention metadata over string parsing
- add tests for group mention and non-mention payloads
- strip mention artifacts before prompt construction

### Risk: overscoping the first release

Mitigation:

- keep policy controls, allowlists, media, and cards out of MVP
- model future settings without implementing them now
- defer V1.1 items to a follow-up spec or implementation plan

## Rollout Plan

### MVP

- register the DingTalk platform
- add schema and configuration UI
- implement credential validation
- implement secure webhook ingestion
- support private and group text handling
- support mention-only trigger in groups
- support text and markdown replies
- add docs and tests

### Follow-up V1.1

Potential next additions after MVP stabilizes:

- `dmPolicy`
- `groupPolicy`
- `allowFrom` and `groupAllowFrom`
- richer unsupported-message handling
- DingTalk-specific UX refinements

### Future V2+

Potential later investments:

- media and file support
- quoted reply restoration
- interactive cards
- automatic webhook registration if DingTalk APIs and stability justify it
- more advanced enterprise policy controls

## Implementation Readiness

This scope is intentionally small enough for one implementation plan.

The design is ready to move into detailed task planning once the written spec is reviewed and confirmed.
