# Web Response Resilience on Network Drop

## Problem

When a user loses internet mid-response on the web, the answer is lost. The Telegram bot does not have this problem because it uses a background queue (QStash) decoupled from the client connection.

The web uses SSE (Server-Sent Events) — a live stream tied to the browser connection. If that connection drops, buffered content not yet flushed to the DB is gone.

## Root Cause

Surprisingly, the server-side resume infrastructure **already exists**:

- Redis stream history is kept for **2 hours**
- `lastEventId` + `includeHistory` params are already wired into the SSE route (`/api/agent/stream`)
- `agent_operations` table already persists status per operationId

The client just never uses any of it. Three bugs stack to cause the failure:

1. **`lastEventId` stored as a timestamp, not a Redis stream ID** (`runAgent.ts:94`) — so even if reconnect was wired, replay would be wrong
2. **Client never reconnects** — `lastEventId` is saved to operation metadata but never read back to drive a resume
3. **DB not flushed until `stream_end`** — if Redis is gone (server restart, 2h expiry), partial content is lost

## Architecture Comparison

| Aspect            | Web (current)                       | Telegram                        |
| ----------------- | ----------------------------------- | ------------------------------- |
| Stream model      | Real-time SSE, connection-dependent | Async webhooks via QStash queue |
| DB write timing   | Only at `stream_end`                | Only at completion              |
| Failure recovery  | None                                | QStash retries until delivered  |
| Client dependency | Must stay connected                 | Fully decoupled                 |

## Solution: Resume-first, flush as safety net

Don't replace streaming with background jobs (kills perceived latency). Instead:

- **Phase 1**: Fix the existing resume infrastructure so the client actually uses it
- **Phase 2**: Add periodic DB flush so Redis expiry is never fatal
- **Phase 3**: Status check on mount to drive the resume vs. settle decision

---

## Phase 1 — Make Redis Resume Actually Work

**Goal:** Transient drop (same tab, ≤2h) reconnects and replays missed events with zero UX impact.

### Task 1.1 — Fix `lastEventId` to store Redis stream ID, not timestamp

**Files:**

- `src/store/chat/slices/aiAgent/actions/runAgent.ts` (line 94)
- `src/server/modules/AgentRuntime/StreamEventManager.ts`
- `src/app/(backend)/api/agent/stream/route.ts`

**What:** In `runAgent.ts:94`, change:

```ts
lastEventId: event.timestamp.toString();
```

to:

```ts
lastEventId: event.id ?? prevLastEventId;
```

Ensure `StreamEventManager` enriches each event with its Redis stream entry ID (e.g. `1700000000000-0`). Update the history filter in `route.ts` to compare against `event.id` (lexicographic, works for Redis IDs) instead of `event.timestamp`.

**Why:** Without this, history replay either re-sends everything or skips events entirely.

**Acceptance:** Unit test — publish 5 events, reconnect with `lastEventId = events[2].id`, assert only events\[3..4] are replayed.

---

### Task 1.2 — Persist `lastEventId` to localStorage keyed by operationId

**Files:**

- `src/store/chat/slices/aiAgent/actions/runAgent.ts`
- Operations slice (wherever `operations` state lives)

**What:** Write `lastEventId` to `localStorage` on every handled event (debounced 250ms to avoid jank). Clear on terminal state (`agent_runtime_end`, or operation status `done | error | interrupted`).

Key: `lobe.lastEventId.<operationId>`

**Why:** Survives hard refresh / tab close — the only way a cross-reload resume is possible.

**Acceptance:** Unit test — dispatch 3 events, assert `localStorage.getItem('lobe.lastEventId.<opId>')` equals the latest Redis ID; dispatch `agent_runtime_end`, assert key is removed.

---

### Task 1.3 — Re-attach SSE on mount when an operation is still alive

**Files:**

- `src/store/chat/slices/aiAgent/actions/agentGroup.ts`
- New helper: `internal_resumeStreamConnection(operationId)`
- Lifecycle mount hook (likely `conversationLifecycle.ts`)

**What:** On topic/chat mount, for each message whose operationId has non-terminal status, call:

```ts
agentRuntimeClient.createStreamConnection(operationId, {
  includeHistory: true,
  lastEventId: localStorage.getItem(`lobe.lastEventId.${operationId}`) ?? '0',
  onEvent: internal_handleAgentStreamEvent,
  ...
})
```

Seed the `streamContext` from the existing DB-persisted assistant message so chunks append to what's already visible.

**Why:** This is the actual reconnect — without it, Tasks 1.1 and 1.2 are inert.

**Note:** Only resume the **most recent non-terminal operation per topic** to avoid opening N SSE connections on a long topic.

**Acceptance:** Integration test — start operation, abort `EventSource` mid-stream, call `internal_resumeStreamConnection`, assert all subsequent chunks appended and final content matches a non-interrupted run.

---

### Task 1.4 — Seed resume context from DB so chunks append correctly

**Files:**

- `src/store/chat/slices/aiAgent/actions/runAgent.ts` (`stream_start` and `stream_chunk` handlers)

**What:** In `stream_start`, if `context.assistantId` is already set (resume path), skip the `deleteMessage` + `createMessage` block. For `stream_chunk`, since content is tracked as a cumulative buffer (`context.content += chunk`), seed `context.content` from the DB-persisted message content when resuming (Task 1.3 passes this via `streamContext`).

**Why:** Without seeding, a resume overwrites existing content with only the delta from `lastEventId` onward.

**Acceptance:** Unit test — pre-seed context with `content: 'hello'`, dispatch `stream_chunk` with `content: ' world'`, assert message is `'hello world'`, not `' world'`.

---

## Phase 2 — Durable Safety Net (parallel with Phase 3)

**Goal:** Even if Redis is gone (server restart, 2h retention window elapsed, hard refresh after long absence), partial content is not lost.

### Task 2.1 — Periodic DB flush every \~500ms during streaming

**Files:**

- `src/server/modules/AgentRuntime/RuntimeExecutors.ts` (call_llm hot path, around `flushTextBuffer` / `flushReasoningBuffer`)

**What:** After each `streamManager.publishStreamChunk`, schedule a debounced 500ms **fire-and-forget** background write:

```ts
debouncedFlush(() => ctx.messageModel.update(assistantMessageItem.id, { content }).catch(log));
```

Cancel the pending debounce immediately before the final authoritative write at the end of the step (so the final write is always last).

Gate behind env var `AGENT_PARTIAL_FLUSH_ENABLED=1` so it can be disabled if DB pressure is a concern.

**Why:** Ensures a hard refresh always shows most of the generated text even without Redis. Also fixes a latent bug: if a `call_llm` step throws after streaming but before the final `messageModel.update`, partial content is currently lost forever.

**Acceptance:** Vitest — spy on `messageModel.update`, run mocked LLM emitting 20 chunks over 5 seconds, assert update called with progressively longer content; last call has full content; no calls after the authoritative final.

---

### Task 2.2 — Mark abandoned "running" operations as `interrupted`

**Files:**

- `src/server/agent-hono/handlers/finalizeAbandoned.ts`

**What:** Verify/extend the existing handler to cover: if `agent_operations.status = 'running'` and `updatedAt < now - 10min` and no recent Redis chunk activity → transition to `interrupted` with `reason: 'timeout'` and write whatever content Task 2.1 has flushed as the final message content.

**Why:** Prevents the UI showing "loading forever" after a server deploy/crash.

**Acceptance:** Test the partial-content path — verify the message DB row ends up with the last-flushed content, not empty.

---

## Phase 3 — Status Reconcile on Mount (parallel with Phase 2)

**Goal:** When the user opens a topic (tab restore, page refresh), decide correctly whether to re-open SSE or just trust the DB.

### Task 3.1 — Add `getOperationStatus` tRPC query

**Files:**

- `src/server/routers/lambda/aiAgent.ts`
- `packages/database/src/models/agentOperation.ts` (already has `findById`)

**What:**

```ts
getOperationStatus: aiAgentProcedure
  .input(z.object({ operationId: z.string() }))
  .query(async ({ input, ctx }) => {
    const op = await operationModel.findById(input.operationId, ctx.userId);
    if (!op) throw new TRPCError({ code: 'NOT_FOUND' });
    return { status: op.status, completionReason: op.completionReason, error: op.error };
  });
```

**Why:** Client needs a cheap, authoritative "is this still running?" check before deciding whether to reconnect.

**Acceptance:** Unit test — returns correct shape for `running`, `done`, `error`; 404s for another user's operationId.

---

### Task 3.2 — Use status check to drive resume vs. settle

**Files:**

- `src/store/chat/slices/aiAgent/actions/agentGroup.ts` (Task 1.3 mount logic)

**What:** Before calling `createStreamConnection`, call `getOperationStatus`:

- `running` / `waiting_for_human` → SSE-resume (Task 1.3)
- `done` / `error` / `interrupted` → call `refreshMessages()` to load final DB content; no SSE needed

**Why:** Avoids re-opening an SSE that will immediately close, and avoids replaying large Redis history for already-finished operations.

**Acceptance:** Two vitest branches — running → `createStreamConnection` called with `includeHistory: true`; done → `createStreamConnection` NOT called, `refreshMessages` IS.

---

## Phase 4 — Tests & Observability

### Task 4.1 — Logging

Add `debug('lobe-agent:resume')` lines for:

- `resuming from lastEventId=X for op=Y`
- `history replay sent N events`
- `skipping resume, operation already terminal`

Record `resumeCount` in operation metadata.

### Task 4.2 — Integration test for the full happy path

**File:** `src/store/chat/slices/aiAgent/actions/__tests__/streamResume.test.ts`

Two scenarios:

- **Drop mid-stream:** live → drop after 3 of 6 chunks → resume → full 6 chunks in message, no duplicates
- **Drop after completion:** live → drop → operation finishes server-side → resume sees `done` → no SSE, `refreshMessages` brings final content

---

## Risks & Mitigations

| Risk                                              | Mitigation                                                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Replay duplicates chunks                          | Task 1.1 fixes wrong-ID-type bug; Task 1.4 idempotency check; Task 4.2 explicitly asserts no duplication |
| Stale debounced flush overwrites final content    | Cancel pending debounce immediately before authoritative `update` in RuntimeExecutors                    |
| Redis evicted, client tries to resume             | Server returns empty history; Task 3.2 sees terminal status and falls back to DB                         |
| Hot path regression in `RuntimeExecutors.ts`      | Fire-and-forget only; no await; behind `AGENT_PARTIAL_FLUSH_ENABLED` env flag                            |
| `lastEventId` localStorage write causes jank      | Debounce localStorage writes to 250ms; in-memory write is immediate                                      |
| Subagent event scoping leak (per `d02df7b89` fix) | Redis stream key is already per-operationId; subagents emit to their own stream                          |

## Open Questions

1. Should resume fan out to all dangling operations in a topic, or only the most recent one? (Recommend: most recent only, to avoid N SSE connections)
2. Should the UI show a "Reconnecting…" indicator? The operation status slice could drive a chip in the message footer.
3. Should Task 2.1 partial flush be enabled globally or gated per plan/tier? (Recommend: global — it also fixes the mid-step-throw data loss bug)

## Key Files Reference

| File                                                    | Role                                                           |
| ------------------------------------------------------- | -------------------------------------------------------------- |
| `src/app/(backend)/api/agent/stream/route.ts`           | SSE endpoint — already accepts `lastEventId`, `includeHistory` |
| `src/server/modules/AgentRuntime/StreamEventManager.ts` | Redis XREAD loop, 2h retention                                 |
| `src/server/modules/AgentRuntime/RuntimeExecutors.ts`   | call_llm step, message create/update                           |
| `src/services/agentRuntime/client.ts`                   | Already plumbs `lastEventId` into `createStreamConnection`     |
| `src/store/chat/slices/aiAgent/actions/runAgent.ts`     | Client event handler — line 94 has the timestamp bug           |
| `src/store/chat/slices/aiAgent/actions/agentGroup.ts`   | Only SSE connector, lines 180-211                              |
| `src/server/routers/lambda/aiAgent.ts`                  | tRPC router for agent operations                               |
| `packages/database/src/models/agentOperation.ts`        | Operation status persistence                                   |
| `packages/database/src/schemas/agentOperations.ts`      | Schema with status, completionReason, error                    |
| `src/server/agent-hono/handlers/finalizeAbandoned.ts`   | Abandoned operation cleanup                                    |
