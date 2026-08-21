# feat(bot): Feishu/Lark group chat support — topic threads, reply-threaded outbound, quote resolution, media passthrough, group history pre-injection, sendDirectMessage

> Branch: `contrib/feishu-group-chat` (based on latest `github/canary`). Paste-ready PR body for `lobehub/lobehub` → `canary`.

## 1. Topic-thread isolation

**Problem.** Feishu topic groups (话题群) collapse every topic into one conversation: the threadId (`feishu:group:oc_xxx`) carries no topic id, so messages in different topics share one agent topic and replies land in the wrong place.

**Changes.** Optional 4th threadId segment: `feishu:group:oc_xxx:omt_yyy` (`packages/chat-adapter-feishu/src/{adapter,types}.ts`). Webhook messages carrying `thread_id` route to their own conversation; plain groups and DMs are unchanged. Old 3-segment ids keep decoding.

**Test plan / evidence.** `packages/chat-adapter-feishu/src/adapter.test.ts`: 4-segment encode/decode + round-trip; topic-group webhook routes to `lark:group:oc_test_chat:omt_topic9`; plain group stays 3-segment. All 87 adapter tests pass:
```
Test Files  1 passed (1)    Tests  87 passed (87)
```

## 2. Reply-threaded outbound

**Problem.** The Chat SDK adapter posts by chatId only — in a topic group, bot replies land on the group's main timeline, not the topic that triggered them.

**Changes.** New `PlatformDefinition.supportsReplyThreading` + `ChatTopicBotContext.triggerMessageId`. When set, the placeholder and every outbound message go through `im/v1/messages/{id}/reply` via `getMessenger(threadId, { replyToMessageId })`; `createMessage` resolves `{ messageId }` so the reply becomes the progress handle for in-place edits (local mode) and the queue-mode callback (`BotCallbackService` rebuilds the same reply-capable messenger). Attachment sends gained a reply twin (`replyMessageWithMsgType`).

**Test plan / evidence.** `adapter.test.ts`: `replyMessageWithMsgType` POSTs to `/im/v1/messages/{id}/reply` with caller msg_type. `apps/server` bot suite passes:
```
Test Files  43 passed (43)    Tests  796 passed (796)
```

## 3. Quoted-message resolution

**Problem.** A reply quoting another message (Feishu `parent_id`) carried no quote context — the agent couldn't see what was quoted.

**Changes.** New optional `PlatformClient.resolveReference`: fetches the parent (sender + text, mentions restored), pulls the whole surrounding topic thread when the parent lives in one, and correctly treats topic-root default replies as *not* quotes. Injected as `<referenced_message>` before the user prompt so it persists in the topic (`AgentBridgeService`).

**Test plan / evidence.** Covered by bot-suite regression tests; degrade paths log and continue (non-fatal by design). No real-credential E2E yet — see "Manual verification" below.

## 4. Rich-text (post) and merged-message media passthrough

**Problem.** `post` bodies (the "@bot + pasted screenshot" case) fell through the webhook switch and were silently dropped; media in router-merged messages was lost because only the triggering message's raw survived.

**Changes.** `post` parsing (`postText` / `postMediaItems`) with inline `img`/`media` download; `mergeSkippedMessages` preserves every constituent's `raw` (`raws`) and `extractFiles` downloads from all of them; quoted media rides the same on-demand path.

**Test plan / evidence.** `adapter.test.ts`: post webhook processed instead of dropped; post parse yields text + image attachment; legacy flat-array post shape; post media downloads every inline image (spy assertions on `downloadResource`).

## 5. Group history pre-injection

**Problem.** On Feishu, group messages that don't @-mention the bot never reach it, so the agent answers without the surrounding discussion — and burning a `readMessages` tool turn isn't possible (Feishu has no history-read API).

**Changes.** New `PlatformDefinition.preInjectGroupHistory` + optional `PlatformClient.readRecentMessages`. On every group wake-up, human messages since the last injection are fetched (watermark `lastGroupHistorySync` in thread state, 24h fallback window; topic threads read the thread container), `@_user_N` placeholders restored to display names (bot self-mentions dropped), bounded media downloaded, and the block prepended to the **user** prompt so it persists across turns. Feishu status reactions mapped to Feishu `emoji_type` ids (API rejects Unicode emoji with 231001).

**Test plan / evidence.** Bot suite passes (796/796); watermark failure paths are isolated (a state error = 24h fallback, never "skip").

## 6. `sendDirectMessage` for Feishu/Lark

**Problem.** Feishu was listed as not supporting `sendDirectMessage`, although the API accepts a `receive_id` directly.

**Changes.** `LarkApiClient.sendDirectMessage` (open_id/union_id/user_id auto-detected) + `FeishuMessageService.sendDirectMessage`; removed from `PLATFORM_UNSUPPORTED_MESSAGE_APIS` for feishu/lark.

**Test plan / evidence.** `apps/server/src/services/bot/platforms/feishu/service.test.ts` (3 tests, passing) + `messageCapabilities` tests.

---

## Notes for reviewers

- No DB schema changes, no new dependencies. All new `PlatformClient`/`PlatformDefinition` members are optional — other platforms are untouched.
- Interface naming aligns with existing optional capabilities (`ensureThreadMember`, `openThreadForChannelWake`).
- Also included: `BotMessageRouter.invalidateBot` stops the evicted client so persistent-connection platforms (Feishu WS) don't receive every event twice after a config change.

**Verification run**
```
$ tsgo --noEmit                      → clean
$ bun run check --lint <files>       → clean
$ vitest apps/server/src/services/bot            → 796 passed
$ vitest packages/chat-adapter-feishu            → 87 passed
```

**Manual verification (needs real Feishu app credentials — not yet run):** topic isolation across two topics of one group; reply landing inside the triggering topic; quote injection; history pre-injection across two wake-ups (no duplicate re-injection).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
