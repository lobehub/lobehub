# Tool control preparation

`execAgent({ hooks })` accepts synchronous `beforeToolCall` webhooks using
`responseHandling: 'toolCall'` and fetch delivery. F's shared registration schema,
`matchesHook` string matcher (identifier/apiName), and response parser apply to
both local registration and persisted worker configuration. Ordinary notification
dispatch skips controls; `deliverWebhook` rejects a control configuration.

Controls run in registration order before GeneralChatAgent permission/audit and
approval decisions, and before single/batch executor lane planning. Each control
sees the previous accepted input. `updatedInput` is a complete replacement, only
on allow. `additionalContext` is retained with the call, including denied calls.
A deny stops only its tool: blocked result, zero attempts, no mock, real execution,
retry, or execution fee. Allow still goes through product permissions and approval.
Cancellation stops waiting and a late allow cannot start execution.

All controls run before observation/mock handlers. A local before handler is
called once; the first mock wins. Legacy dual handler/webhook hooks select the
handler locally and the webhook in queue mode. Critical notification callbacks
retain `fallback: 'none'` failure propagation.

## Hook runtime identity

Step/terminal, human, compact and parent call-agent notifications use the
producer's trusted runtime account in `userId`. Share visitor state does not
override these thirteen event identities. Permissions, service/model
accounts and persisted ownership retain their existing runtime owner semantics.
Internal callback owner closures and server-created static routing context remain
unchanged; no public owner or actor field is added.

Durable human continuations deliver with the resumed service's runtime account,
including historical ledger events that contain the former visitor identity.
Parent call-agent notifications use the parent caller's runtime account.
The share entry point still forces headless approval and blocks sub-agent calls.

This is a staged migration: the three tool notification identities and shared
email authorization interfaces still follow the inherited contract. The shared
identity helper remains until the upstream tool builder stops referencing it.

## Preparation and persistence

- `RuntimeConfig.prepareTools(context, state)` runs before runtime decisions;
  `createRuntimeToolPreparation` wires the server to `createToolPreparation`.
- `ToolTransport.prepare` returns serializable `ToolCallPreparation`:
  `originalArgs`, optional `effectiveArgs`, `additionalContexts: {hookId,text}[]`,
  optional reviewed `approvalArgs`, `status: ready | blocked | cancelled`, `reason?`.
- `prepareToolCalls` is also used by direct executors before lane planning.
  `state.toolPreparations[nativeCallId]` is scoped by `toolPreparationParentId`
  (the original assistant turn). Internal execution retries reuse preparation.
  The caller's context is cloned, so a retained step context cannot accumulate
  rewrites on retry.
- The effective input is shared by audits, pending cards, lane serialization,
  server/device/client dispatch and before/after/error payloads. C2 retains
  `originalArgs` separately in preparation and internal `ToolRunContext`; the
  server-only `ToolCallControlEvent` carries its clone to controls. T's public
  lifecycle notification context does not expose original arguments.
- Existing tool rows store `pluginState.hookPreparation`. `updateToolCall`
  atomically updates plugin arguments and preparation, without a new table or
  process-global cache. Human resolution records `approvedArguments` in the
  existing intervention data before any resumed rewrite can change the row.

The assistant's persisted `tools` can still contain the model's original request:
LLM finalization precedes hook preparation. `conversation-flow` overlays the
matched prepared tool row's `plugin.arguments` when constructing its assistant
block, so cold approval cards read the same effective input as execution.
`ToolHookContextProvider` performs the equivalent projection for raw inline
history before MessagesEngine emits provider tool calls. Durable rows are bound
by assistant parent and native call ID; raw in-memory rows without a parent use
the nearest preceding caller. Neither projection mutates stored history or the
original preparation snapshot. Unprepared/streaming calls retain their prior
behavior. Existing prepared rows benefit on reload without a migration.

Controls use the shared per-dispatcher async webhook payload builder after each
hook's effective arguments have been selected. Empty body/projection settings
preserve the authoritative event. The control snapshot is cloned from
`context.originalArgs ?? context.parsedArgs`; recovered original input cannot be
replaced by already rewritten arguments. Email enrichment follows the inherited
trusted-identity policy. Query timeouts belong to the database; the Hook layer
adds no timer. Missing or failed enrichment omits email; an aborted wait returns
`cancelled` and sends no control HTTP request. Cancelling one waiter does not
cancel an independent sibling or the shared database query.

Notification callers may supply server-only `HookDeliveryContext { ownerUserId }`
per delivery: the fifth argument of `dispatch` or the fourth argument of
`dispatchBeforeToolCall`. The private `dispatchHooks` keeps `stopAfterHandler` in
position five and receives delivery context in position six. No context is stored
on the dispatcher, serialized with hooks or added to the payload. The shared
builder authorizes the final user ID before reading its email cache and never
queries an operation owner. L owns supplying trusted owner context at producers,
including cold workers. Control preparation keeps its fourth `AbortSignal` and
uses `{ signal }` without owner context because its final ID is the event user.

## Approval recovery

Both legacy in-place `human_approved_tool` and new continuation workers load the
original input from the existing tool row and rerun controls. They compare the
new effective input with the reviewed snapshot, not with the now-mutable plugin
arguments. A changed input re-enters the normal agent permission/audit path;
`human_approved_tool` cannot grant approval for the changed request. A new deny
produces a blocked result with no execution.

A new or rebuilt continuation requires the authoritative source runtime state.
If it is missing (including after the state manager's two-hour TTL), or loading
it throws, preflight fails before successor message creation, history/tool
discovery, or operation creation/scheduling; absence is never interpreted as an
empty hook list. This preflight runs after ready-continuation reuse, reads the
source once, and hands the validated snapshot to startup. Legacy approval claims are rolled back to
their prior tool snapshots, leaving the reviewed effective input and context
intact. Generic durable claims retain their existing same-request retry ownership
and propagate the error without scheduling a worker or dispatching notifications.
Both paths can retry a transient source-read failure; generic retry uses the same
resolution identity and does not consume another claim. Partial decisions do not
claim or rewrite still-pending siblings on failure.
A ready deterministic continuation can still resume from its own persisted
hooks/events after the older source expires. This does not extend the source TTL
or reconstruct lost hook configuration from tool input/context fragments.

When a changed call needs human approval again, reuse its tool message and
supersede the review batch, carrying all still-pending siblings. The generic
`supersedes.reapprovedToolCallIds` field identifies decided members being reopened
with a different request revision. Cross-operation continuations create a new
review batch. In-place recovery rotates the existing member's review token and
request revision atomically because `(operationId, toolCallId)` is unique. The
old resolution remains in the existing resolution ledger. Same-request replay is
idempotent. Old token/revision snapshots cannot approve the rewritten request.

### Cloud supersession integration boundary

The OSS runtime builds this field in
`apps/server/src/services/agentRuntime/agentInterventionNotification.ts`.
`CompletionLifecycle.notifyPendingAgentIntervention` passes the DTO through
`@/business/server/agent-run/agentInterventionReview`. In this repository that
alias resolves to `packages/business-server/src/agent-run/agentInterventionReview.ts`:
its interface includes the field, but `notifyAgentInterventionRequired` is an
intentional no-op. The durable implementation is Cloud-specific.

The local Cloud checkout was inspected read-only at
`4b2a32725fa3da5fe28b94d9ffb74697f2d0d8e7`; these files had no local edits:

- `src/business/server/agent-run/agentInterventionReview.ts` binds the v2 wrapper.
- `src/server/services/agentIntervention/wrapperV2.ts` passes the entire notification
  to `notification.notifyRequired(params)`.
- `src/server/services/agentIntervention/deliveryV2.ts` passes the entire
  `notification.supersedes` object to its `createBatchWithSupersession` dependency.
- `src/server/services/agentIntervention/defaultDeliveryV2.ts` passes that same
  `supersedes` object to `AgentInterventionModel.createBatchWithSupersession`.

This inspected implementation already preserves additive fields; no extra Cloud
source edit is required for `reapprovedToolCallIds`. Cloud must still integrate
C2's database model/types from the OSS dependency. Its existing
`deliveryV2.test.ts` asserts whole-object supersedes forwarding, but does not
specifically exercise this new field; those external tests were not run here.
C2 tests explicitly cover runtime DTO forwarding and both same-operation and
cross-operation database reapproval, including old token/revision rejection.
D still needs to verify the deployed overlay and an actual partial/mixed review.

If an older/different overlay strips the field, same-operation supersession is
rejected (no declared reapproved members); cross-operation reapproval also fails
its exact old-pending-member check when already-decided members are included.
The durable new review cannot be published and the parked lifecycle reports a
persistence failure. This is an availability/integration failure, not permission
to execute changed input under the old approval. If the overlay lacks the entire
supersession dependency, the inspected Cloud code throws
`AGENT_INTERVENTION_SUPERSESSION_UNAVAILABLE` before creating a new review.

## Additional context

`ToolHookContextProvider` projects the persisted fragments through MessagesEngine
onto the ordinary tool result, escaped and deduplicated by tool row/native call
and hook ID. It creates no user or system messages and does not modify stored
result content. Queue workers reconstruct the same projection from tool rows;
reprocessing an already projected message does not append the fragment twice.
Recovery retains prior fragments and replaces a hook's fragment if it returns
updated guidance.

## Intervention notifications

The existing four `@lobechat/agent-runtime` human-intervention builders define
before/after/stop context and native ID semantics. Before notification uses the
same effective pending calls as the approval card. New continuations inherit
source hooks (including serialized webhook hooks) and persist after events on
the host envelope. Actions are grouped by action and rejection reason; each event
contains only the calls decided by that group. Claim and rollback do not dispatch.
The first executing continuation consumes events under the existing step lock;
deterministic reuse resumes the saved envelope instead of generating events again.

The persistence/delivery order for D's recovery checks is:

1. Atomically claim the human decisions on the existing tool rows. No notification
   is dispatched by the claim or its rollback.
2. Create the continuation with source hooks and grouped events in `host`, then
   persist its existing preparation/ready marker before scheduling its first step.
3. Under the execution step lock, load the saved envelope. For each action group,
   await the existing dispatcher, save a new envelope containing only the remaining
   groups, and only then update the in-memory ledger. A failed save keeps the
   original in-memory ledger intact.
4. A replacement worker or deterministic reuse reads this same saved remainder.
   A later group's failure does not resend groups whose checkpoint succeeded.
   Concurrent deliveries that do not obtain the step lock do not consume events.

The legacy original-operation handler sends its own notifications directly and
does not create a continuation ledger. The modern claim accepts pending rows or
its exact deterministic resolution ID; a row already resolved by the legacy
handler cannot start a second modern handoff. The ready-continuation reuse path
neither regenerates events nor calls the legacy handler.

Explicit stop is a separate inline path, because no next worker may exist. Its
order is: validate all pending members, atomically settle their rows, acknowledge
runtime interruption, persist operation completion together with
`metadata.pendingStopHookBatchId`, then directly dispatch the stop event with
every affected native ID. Dispatch returning consumes that marker in an
owner/batch/status-scoped update; a critical throw leaves it pending. The same
resolution request can retry this direct dispatch while the operation remains
`interrupted`, loading the original host hooks from existing runtime state. If
that state is unavailable, retry fails explicitly instead of reporting delivery
success. A successful normal replay sees no pending marker and sends nothing.
The generic source and Review-token routers also treat an interrupted operation
with a matching pending marker as prepared, not dispatched. They propagate the
failure and keep the existing resolution claim retryable; only marker consumption
permits publishing the completed Review. A different pending batch fails closed.
Custom cancellation retries only its stop/checkpoint, without repeating its
marketplace action. Already-published resolutions from older buggy routers are
not reopened or migrated by this change.
The stop is never rolled back, and no continuation is started. Legacy terminal
rows without a marker do not synthesize a notice. An unacknowledged stop or failed
terminal write sends none. Ordinary modern reject does not fabricate a stop; the
legacy reject-and-halt handler retains its existing actual-halt semantics.

Notification response bodies are ignored, even if they resemble a control
response. They cannot change tool inputs, cancellation, or human decisions.
Delivery failures retain the existing dispatcher policy: ordinary notification
failures are logged/swallowed, so the action group is consumed; a critical
`fallback: 'none'` error exits the drain with that group still pending. Step-level
critical-error propagation/retry is the separate L change, not a new C2 retry
loop. Within a group, a retry may redeliver to an earlier hook if a later critical
hook failed; the ledger checkpoint is per action group, not per HTTP endpoint.

HTTP controls do not retry automatically. A replay before preparation is saved
may issue another HTTP request. For continuation notifications, a crash before
delivery leaves the group pending; a crash after delivery but before saving its
checkpoint may repeat it. If the checkpoint succeeded, a normal replacement
worker does not repeat that group. Inline stop uses the existing operation row's
pending marker and runtime host state for request-driven retry: a crash before
dispatch leaves the marker; delivery followed by a crash or failed marker removal
may repeat the notice. Concurrent retries may also repeat delivery; the marker
is a completion checkpoint, not a delivery lease. There is no background stop
retry. Ordinary dispatcher failures are still swallowed and consume the marker;
they do not gain reliable delivery. The legacy direct handler keeps its existing
crash windows. A notification delivery error never rolls back the completed stop
or human decision. There is no independent outbox, guaranteed delivery, or
cross-crash exactly-once claim.

### Await latency

Controls await matching HTTP hooks serially, so their request time contributes
to tool preparation before permissions/cards/execution. Each direct HTTP request
uses the configured timeout (30 seconds by default); multiple hooks accumulate
latency. Stop dispatch is also awaited inline after business interruption is
persisted: the operation is stopped even while the HTTP stop response waits for
notifications, and a critical error can fail that response without undoing the
stop. Continuation workers await each notification group before runtime execution.
QStash notification delivery waits for publish acknowledgement, not endpoint
completion; its destination timeout is not an overall SDK publish deadline.
Notification response bodies cannot modify controls, cancellation or approvals.

## Verification boundary

C2's regression suite covers runtime/dispatcher/transport, database persistence,
approval re-planning, context projection and notification recovery. D owns real
HTTP/QStash, rendered cards and device acceptance. These tests do not claim that
product acceptance has completed; keep the integration PR draft until D reports.

## Persisted cancellation at tool boundaries

`RuntimeExecutorContext.checkToolCancellation()` is an optional server-only, per-step callback created by `AgentRuntimeService.executeStep`. Production execution binds it to that service's coordinator and immutable operation ID; event identity, arguments and webhook configuration cannot choose the cancellation source. It reads the persisted interruption sentinel and aborts the existing step-local controller when a stop is visible. It is not serialized or shared through a global controller registry. Existing 2-second polling/backoff still cancels work already in flight.

`createRuntimeToolPreparation` checks before and after preparation, including cached preparation and durable approval reads. `ServerToolTransport.prepare` checks before controls and passes a fifth callback to `HookDispatcher.prepareToolCall`; its fourth argument remains the AbortSignal. The dispatcher checks each matching control before enrichment, after the asynchronous payload builder and after its HTTP response, before applying a decision or proceeding to another control. A visible stop returns cancelled independently of onError; late allow cannot authorize the next control or tool.

The transport also checks before using a ready preparation, after beforeToolCall observation/mock dispatch, and immediately before gateway dispatch or the first server/device tool attempt after async visibility lookup. Internal retry decisions use the same authority when available, without rerunning preparation. The server approval executor checks again after asynchronous permission classification and routes a visible stop through the existing aborted-tool row settlement, without creating pending approvals. Standalone adapters without a persisted-operation callback keep their AbortSignal behavior and existing retry fallback. Generic dispatch fifth owner context, dedicated before fourth context, private dispatch fifth mock callback/sixth owner context, email authorization/cache and terminal/critical notification delivery are unchanged. Email query timeouts are owned by the database, with no Hook-layer timer.

Cancellation-read errors fail closed with an explicit `Unable to verify operation cancellation` error (no raw storage error). The failure is retained for the rest of this step, including concurrent checks, and rethrown at the service boundary even if a tool executor treated it as an ordinary tool error. It cannot be interpreted as not interrupted, converted to allow by onError:continue, or schedule the next step. It is an execution error, not a claim that a user stop was observed.

These are fresh checks, not an atomic distributed launch lease. A stop can still race after a successful read and before the external service actually receives a request, or arrive after work has already started. Existing polling/signal forwarding then remains best effort; this change does not retract emitted HTTP, undo executed side effects, or provide exactly-once execution. The fixed guarantee is that a stop already visible to the authoritative boundary read prevents that new control/attempt. No polling interval, optional email failure policy, outbox, public Hook schema or owner lookup has been changed.
