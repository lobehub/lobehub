# Agent Gateway protocol v2 — one WebSocket per user (multiplexed)

Status: design contract shared by three codebases. Every implementer works from this file;
if you must deviate, document the deviation at the top of your report.

Repos:
- `agent-gateway` (Cloudflare Worker, Durable Objects) — worktree `/Users/arvinxx/CodeProjects/LobeHub/agent-gateway-wt-user-hub`
- `lobehub` server (`apps/server`) and client (`packages/agent-gateway-client`, `src/store/chat/.../gateway`) — worktree `/Users/arvinxx/CodeProjects/LobeHub/lobehub-wt-gateway-mux`

## 0. Why

Today: one `AgentOperationDO` per operation AND one browser WebSocket per operation
(`GET /ws?operationId=`). N running ops in a tab ⇒ N sockets, each with its own heartbeat,
backoff, JWT. Member / sub-agent ops are never subscribed (server-side `mirrorToOperationId`
hack copies member events onto the supervisor channel).

Target: per browser tab, ONE WebSocket to a per-user `UserHubDO`; every operation is
multiplexed over it with explicit `subscribe`/`unsubscribe`. `AgentOperationDO` stays the
single writer of op state (seq, buffer, watchdog, confirmation long-polls) and forwards to
the hub. v1 (`/ws?operationId=`) stays fully working and byte-for-byte unchanged for legacy
clients (web without the Labs flag, CLI, desktop).

Non-goals for this iteration: SharedWorker cross-tab sharing; removing `mirrorToOperationId`
/ `subagent_progress`; migrating CLI; removing v1.

## 1. Topology

```
LobeHub server ── POST /api/operations/{init,push-event,tool-execute,...} ──▶ AgentOperationDO (session:${operationId})
                                                                                   │ internal DO→DO fetch
                                                                                   ▼
Browser tab ──── GET /v2/ws?token=… ────────────────────────────────────▶ UserHubDO (user:${userId})
```

Bindings (wrangler.toml): add `USER_HUB` → class `UserHubDO`; migration tag `v3`
`new_classes = ["UserHubDO"]`. `Env.USER_HUB: DurableObjectNamespace`.

Hub id: `env.USER_HUB.idFromName(\`user:${userId}\`)` where `userId` is the JWT `sub`
(for share visitors this is the visitor user id — the same value LobeHub sends as
`streamOwnerUserId`/`userId` in `init`, so ownership checks line up unchanged).

## 2. Worker routes (src/index.ts)

Existing routes unchanged. New:

- `GET /v2/ws` — browser WS upgrade. Auth happens **at upgrade time** (no in-socket `auth`
  message in v2):
  - `token` query param (required). `tokenType` (`jwt` default | `apiKey`) and `serverUrl`
    optional, resolved with the existing `resolveSocketAuth` from `src/auth.ts`.
  - On auth failure: accept the socket pair in the worker and immediately
    `server.close(4401, reason)` (`'auth_expired'` when only `exp` failed, else
    `'auth_failed'`). Rationale: browsers can't read HTTP status on WS failure; a close code
    is the only reliable signal.
  - On success: forward the upgrade to the hub stub with headers
    `x-lobe-user-id`, `x-lobe-client-id` (optional `clientId` query, default a random id).
- Hub internal routes (only reachable via DO stubs; not exposed on the worker):
  see §4.

## 3. AgentOperationDO changes (src/AgentOperationDO.ts)

### 3.1 P0 fixes (independent value, land as their own commit)
1. **Persist the sequence.** Replace in-memory `eventCounter` with storage key `seq`
   (number). `nextEventId()` must be monotonic across eviction/hibernation: load `seq` lazily
   in `blockConcurrencyWhile` on construction, increment in memory, and write it in the same
   `storage.put({...})` batch as `lastEventAt`/`lastEventType` (one multi-key put per event
   instead of two). Ids stay strings of integers.
2. **Resume gap instead of full replay.** `handleResume`: if `lastEventId` is not in the
   buffer and is non-empty: replay only events with numeric id > lastEventId (buffer is
   ordered). If the buffer's first id > lastEventId+1 (or buffer empty while `seq` >
   lastEventId), the client missed events that are gone ⇒ `resume_complete` carries
   `gap: true`. Empty `lastEventId` = "from the beginning" (replay everything buffered;
   `gap` true iff buffer doesn't start at id 1).
3. **Tool result URL.** `_forwardToolResult` must use
   `${LOBE_API_BASE_URL ?? DEFAULT_LOBE_API_BASE_URL}/api/agent/tool-result`.
4. **Auth before init.** A v1 socket authenticating before `init` landed must not be
   accepted as owner of anything: keep the socket open but mark the attachment
   `pendingOwner: true`; when `init` lands, re-check `userId` and close mismatches with
   1008 `'userId mismatch'`. (Do not change the timing of `auth_success` for matching users.)
5. Watchdog: `tool-execute` and `update-status` also `touchActivity`.
6. `session_complete` is only broadcast for `completed`; `error`/`interrupted` endings send
   `status_change` (they already do via `update-status`; align the `agent_runtime_end` path).
   Keep sending BOTH `status_change` and then `session_complete` when status is `completed`
   is NOT required — just `session_complete`. Legacy web client treats `session_complete`
   as terminal regardless, so make sure `status_change{error|interrupted}` is followed by a
   `session_complete` **for v1 sockets only** to preserve today's terminal semantics
   (i.e. v1 wire behavior unchanged: v1 still gets `session_complete` for every ending; the
   hub gets the precise status via lifecycle, §3.3).
   ⇒ Simplest implementation: keep the v1 broadcast exactly as today, and add the precise
   status in the lifecycle notification only.

Leave `interrupt` as-is (documented no-op; the web client interrupts via tRPC). Do not
attempt to implement it.

### 3.2 Init metadata
`POST /api/operations/init` body becomes
```ts
{ operationId, userId,
  meta?: { topicId?, threadId?, agentId?, groupId?, taskId?, scope?,
           parentOperationId?, mirrorToOperationId?, rootOperationId? } }
```
Persist `meta` (storage key `meta`). Unknown fields ignored. Missing `meta` is fine (legacy).

### 3.3 Forwarding to the hub
After `init` the op DO knows `userId` ⇒ `hub = env.USER_HUB.get(idFromName(\`user:${userId}\`))`.

Two classes of forward, both `POST` to the hub stub (fire-and-forget via `waitUntil`, 5s
timeout, errors logged, never fail the backend request):

- **Lifecycle** (always): `POST /internal/op-lifecycle`
  `{ operationId, userId, status, meta, at, summary? }` sent on: `init` (status `running`),
  every stored status change (`update-status`, `agent_runtime_end`, watchdog), and on
  cleanup (`status: 'gone'`).
- **Stream** (only while `hubSubscribed === true`, a persisted boolean):
  `POST /internal/op-event` `{ operationId, message }` where `message` is exactly the
  `ServerMessage & {id}` that `broadcastAndBuffer` sends to v1 sockets
  (`agent_event` / `session_complete` / `status_change` / `tool_confirmation_request` /
  `input_request`). Response `{ delivered: number }`; if `delivered === 0` set
  `hubSubscribed=false` (self-healing after hub eviction).

Ordering: the hub is called from inside `broadcastAndBuffer` in id order, but forwards are
async — include `id` and let the hub order by numeric id (it drops ids ≤ per-socket lastSeq).

### 3.4 Internal routes on the op DO (called by the hub)
- `POST /api/operations/hub-subscribe` `{}` → sets `hubSubscribed=true`, returns
  `{ userId, status, meta, seq }`. (`userId` undefined ⇒ not inited yet.)
- `POST /api/operations/hub-unsubscribe` `{}` → `hubSubscribed=false`.
- `POST /api/operations/replay` `{ since: string }` → `{ events: BufferedEvent['data'][],
  status?: SessionStatus, gap: boolean, seq: number }` — same semantics as §3.1.2.
- `POST /api/operations/client-message` `{ message: ClientMessage, connectionId }` → the
  op DO handles `tool_result` / `tool_confirmation` / `user_input` / `interrupt` exactly as
  if they had arrived on a v1 socket (refactor the v1 `webSocketMessage` switch into a
  shared `handleClientMessage(message, sender)` used by both paths).

All `/api/operations/*` routes keep the existing `SERVICE_TOKEN` check at the worker; DO→DO
stub calls bypass the worker so they need no token.

## 4. UserHubDO (new file src/UserHubDO.ts)

State:
- storage `conn:${connectionId}` → `{ userId, clientId, connectedAt,
  subs: Record<operationId, { lastSeq: number; executor: boolean; state: 'pending'|'replaying'|'live' }> }`
  (subscriptions live in storage, NOT in the 2 KB socket attachment; attachment holds only
  `{ connectionId, userId }`).
- in-memory: per-(connection, op) live-event queue used while `replaying`.

WebSocket handling (Hibernation API):
- `acceptWebSocket(server, [userId, connectionId])` (tags!) so `getWebSockets(tag)` works.
- `setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"heartbeat"}','{"type":"heartbeat_ack"}'))`
  — heartbeats never wake the DO. Idle check alarm every 120s: close sockets whose
  `ctx.getWebSocketAutoResponseTimestamp(ws)` (or connectedAt) is older than 180s.
- On open send `ready { type:'ready', userId, connectionId, protocol: 2 }`.
- `webSocketClose`/`webSocketError`: delete `conn:*`, decrement op refcounts; when an op has
  no subscriber left across all connections, call op DO `hub-unsubscribe`.

Client → hub messages (JSON, all carry `operationId` where relevant):
```ts
| { type:'subscribe'; operationId; lastEventId?: string; executor?: boolean }
| { type:'unsubscribe'; operationId }
| { type:'heartbeat' }                                    // auto-answered
| { type:'tool_result'; operationId; toolCallId; content; success; error?; state?; workRegistration? }
| { type:'tool_confirmation'; operationId; toolCallId; approved }
| { type:'user_input'; operationId; requestId; content }
| { type:'interrupt'; operationId }
```
Hub → client messages:
```ts
| { type:'ready'; userId; connectionId; protocol: 2 }
| { type:'agent_event'; operationId; id; event }          // event.operationId may differ (mirrored member)
| { type:'session_complete'; operationId; id; summary? }
| { type:'status_change'; operationId; id; status }
| { type:'tool_confirmation_request'; operationId; id; toolCallId; tool }
| { type:'input_request'; operationId; id; requestId; prompt }
| { type:'resume_complete'; operationId; status?: SessionStatus; gap: boolean; pending?: boolean }
| { type:'subscribe_failed'; operationId; reason: 'forbidden' | 'invalid' }
| { type:'op_lifecycle'; operationId; status: SessionStatus | 'gone'; meta?; at; summary? }
| { type:'heartbeat_ack' }
| { type:'error'; code; message; operationId? }
```

Subscribe algorithm (per connection, per op):
1. Record sub `{ lastSeq: Number(lastEventId ?? 0), executor, state:'replaying' }`.
2. Call op DO `hub-subscribe`. If it returns a `userId` that ≠ hub's userId ⇒
   `subscribe_failed{forbidden}` and drop the sub. If `userId` is undefined (op not inited
   yet — the init/subscribe race: a subscriber that arrives before the op exists must not be
   answered with an empty replay, because the client reads an empty replay as a finished
   session and clears the shared `runningOperation`): keep the sub with `state:'pending'`,
   send `resume_complete{ pending:true, gap:false }` and return; when an `op-lifecycle` with
   status `running` arrives for that op, run steps 3-5 for every pending sub.
3. Call op DO `replay{ since: String(lastSeq) }`; send each returned message (with
   `operationId` added) in order, updating `lastSeq`.
4. Flush the in-memory live queue for this (connection, op): send those with id > lastSeq.
5. Send `resume_complete{ operationId, status, gap }`; state ⇒ `live`.

Live delivery (`/internal/op-event`): for every connection subscribed to the op:
`replaying` ⇒ enqueue; `live` ⇒ send if `Number(id) > lastSeq`, then set lastSeq.
`agent_event` whose `event.type === 'tool_execute'` is delivered **only to subs with
`executor:true`**; if no executor sub exists for the op, deliver to all subs (v1 parity).
Return `{ delivered }` = number of sockets it was sent or queued to.

Lifecycle delivery (`/internal/op-lifecycle`): broadcast `op_lifecycle` to every socket on
the hub (the user-level feed). On `gone`, remove the op from all subs.

Client messages that target an op: verify the connection is subscribed to it (else
`error{code:'not_subscribed'}`), then forward to op DO `client-message`.

## 5. LobeHub server (apps/server)

1. `GatewayStreamNotifier.publishAgentRuntimeInit`: send `meta` (§3.2) in the `init` body,
   taken from the op metadata already passed in (`topicId`, `threadId`, `agentId`,
   `groupId`, `taskId`, `scope`, `parentOperationId`, `mirrorToOperationId`,
   `rootOperationId` — only those that exist on the metadata; do not invent lookups).
2. New tRPC procedures returning `{ token }` = `signUserJWT(<subject>)` (5m TTL, as today):
   - `aiAgent.issueGatewayUserToken` — no input, subject `ctx.userId`.
   - `shareChat.issueGatewayUserToken({ agentShareId })` — subject the visitor user id
     resolved the same way `shareChat.refreshGatewayToken` resolves it (reuse its helper),
     without requiring a running operation.
   Keep `refreshGatewayToken` untouched (v1 path).
3. `src/services/aiAgent.ts` `issueGatewayUserToken()` and `src/services/shareChat.ts`
   `issueGatewayUserToken(agentShareId)` wrappers.
4. Tests for both procedures and the init body.

## 6. Client package (`packages/agent-gateway-client`)

New `src/mux/` exporting `GatewayMuxClient` and `createOperationClient`:

```ts
interface GatewayMuxClientOptions {
  gatewayUrl: string;                       // same base as v1; client appends /v2/ws
  getToken: () => Promise<string>;          // called before EVERY connect attempt
  clientId?: string;
  autoReconnect?: boolean;                  // default true
  heartbeatIntervalMs?: number;             // default 30_000, sends exactly {"type":"heartbeat"}
}
class GatewayMuxClient {
  connect(): Promise<void>; disconnect(): void;         // idempotent; refcount-free (owner decides)
  readonly status: 'disconnected'|'connecting'|'connected';
  subscribe(operationId, opts?: { lastEventId?: string; executor?: boolean }): OperationSubscription;
  on(event: 'lifecycle'|'status_changed'|'error'|'connected'|'disconnected'|'reconnecting', cb): () => void;
}
interface OperationSubscription {
  operationId: string;
  on<K extends keyof AgentStreamClientEvents>(event: K, cb: AgentStreamClientEvents[K]): () => void;
  // plus 'resume_complete': (info: { status?: SessionStatus; gap: boolean; pending?: boolean }) => void
  sendToolResult(result: ToolResultPayload): boolean;   // queued while disconnected, TTL 120s
  sendInterrupt(): boolean;
  unsubscribe(): void;
}
```

Behavior:
- Single socket; `subscribe` while disconnected triggers `connect()`; on (re)connect the
  client re-sends `subscribe` for every live subscription with its per-op `lastEventId`.
- Reconnect: exponential 1s→30s **with full jitter**; immediate reconnect on `online` and on
  `visibilitychange` to visible when the socket is not open; close code 4401 ⇒ refresh token
  (via `getToken`) then reconnect (count toward backoff after 3 consecutive 4401s ⇒ emit
  `auth_failed` on every subscription and stop).
- Dedup: per-op numeric `lastSeq`; drop messages with id ≤ lastSeq.
- Terminal semantics per subscription mirror v1 `AgentStreamClient`: own
  `agent_runtime_end`/`error` (event.operationId === sub op or absent) ⇒ emit
  `session_complete{source:'agent_event'...}` (reuse the existing
  `AgentStreamSessionCompletion` shape) and auto-unsubscribe; `session_complete` message ⇒
  same; `resume_complete` with terminal status ⇒ `session_complete{source:'resume_status'}`;
  `resume_complete{pending:true}` ⇒ keep waiting (emit `resume_complete` only).
- `createOperationClient(mux, operationId, { resumeOnConnect?, lastEventId?, executor? })`
  returns an object structurally compatible with the store's
  `GatewayConnection['client']` Pick (`connect`, `disconnect`, `on`, `reconnect`,
  `sendInterrupt`, `sendToolResult`, `updateToken`): `connect` = subscribe, `disconnect` =
  unsubscribe, `reconnect` = unsubscribe+subscribe with lastEventId, `updateToken` = no-op
  (token comes from `getToken`). Emits the same `AgentStreamClientEvents`
  (`connected` when `resume_complete`/first event arrives or immediately if the socket is
  open, `disconnected` on unsubscribe/socket loss, etc.).
- Export protocol message types for v2 from `src/mux/types.ts`, and re-export from index.

## 7. Store integration (`src/store/chat/slices/agentRun/actions/transports/gateway`)

- Labs flag `enableGatewayMux` (labPrefer selector + `LAB_FEATURES` entry `gatewayMux`,
  stage `alpha`, i18n `labs` namespace en-US + zh-CN).
- `GatewayActionImpl.createClient(options, ctx)` — when the flag is on, return
  `createOperationClient(getMux(identity), operationId, {...})` where `identity` is
  `'owner'` (getToken = `aiAgentService.issueGatewayUserToken`) or `share:${agentShareId}`
  (getToken = `shareChatService.issueGatewayUserToken(agentShareId)`); one
  `GatewayMuxClient` per identity per page (module-level registry). Flag off ⇒ v1
  `AgentStreamClient` exactly as today.
- `resume_complete{gap:true}` ⇒ run the same DB refetch as the `notify_update` handler
  (`fetchAndReplaceMessages`) for the op's topic.
- The rest of `connectToGateway` / `reconnectToGatewayOperation` / event handler stays.
- `executor: true` for subscriptions created by `executeGatewayAgent` (this tab started the
  run); `false` for `reconnectToGatewayOperation`.
- Mux-level `lifecycle` events: store them in a small slice `gatewayFeed[operationId] =
  { status, meta, at }` (no UI yet; selector only) so later work can drive spinners/reconnect.
