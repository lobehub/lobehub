# Agent Runtime HTTP hooks — unpublished integration draft

This draft describes integration base `c1a8e81f7449f03b5987aeb7fbbd70a5bf49e5cc` (C2 + S + K + L). It is not release documentation. The implementation accepts allow/deny, full input replacement and additional context; the temporary control guard has been removed.

Bounded real HTTP, device, Web reapproval and Cloud source-API evidence is recorded. Effective-argument card projection and missing-source recovery have been repaired; source Stop critical retries are observed on the current integration. Full token/partial/mixed UI, successful model inference and managed QStash delivery remain unverified, and cancelled tools still have an incorrect Edited summary. This unpublished draft describes the implemented contract, not complete product acceptance.

## Register hooks in server code

Hooks belong to one server Agent operation. Pass them to `AiAgentService.execAgent({ hooks })` from trusted application code with an existing database, user, and Agent. `hooks` is a server programming option, not a browser request field, global policy, configuration file, environment-based deployment switch, or management UI.

```ts
import type { AgentHook } from '@/server/services/agentRuntime/hooks/types';

const hooks: AgentHook[] = [
  {
    id: 'observe-tools',
    type: 'afterToolCall',
    matcher: '^example-tools/',
    webhook: { url: 'https://hooks.example.com/events', timeout: 5 },
  },
  {
    id: 'check-tool',
    type: 'beforeToolCall',
    matcher: '^example-tools/writeFile$',
    webhook: {
      url: 'https://hooks.example.com/check',
      delivery: 'fetch',
      responseHandling: 'toolCall',
      onError: 'block',
      timeout: 5,
      headers: { Authorization: 'Bearer ${HOOK_TEST_TOKEN}' },
      allowedEnvVars: ['HOOK_TEST_TOKEN'],
    },
  },
];
await aiAgentService.execAgent({ agentId, prompt, hooks });
```

The variables `aiAgentService`, `agentId`, and `prompt` come from your server integration. The example token name only demonstrates an explicitly allowlisted header template; it does not add a Hook deployment configuration entry. Templates are persisted unexpanded and resolved at delivery time. Never log expanded credentials.

`matcher` is a **string regular expression** tested against the combined name `${identifier}/${apiName}`. Omitted, empty, or `*` matches every tool. It is valid only for `beforeToolCall`, `afterToolCall`, and `onToolCallError`. Use anchors when an exact match is intended. Invalid patterns and non-tool matchers are rejected on registration and restoration.

## Delivery modes

| Registration                     | Local server runtime | Queue server runtime                       |
| -------------------------------- | -------------------- | ------------------------------------------ |
| webhook only                     | HTTP delivery        | HTTP delivery from persisted configuration |
| handler and notification webhook | in-memory handler    | webhook                                    |
| handler only                     | in-memory handler    | no persisted handler delivery              |

Runtime mode and webhook transport are different choices. `delivery:'fetch'` (default) awaits the HTTP request even in queue runtime. `delivery:'qstash'` publishes a notification to QStash; acknowledgement means the queue accepted it, not that the target received it. A QStash publish failure uses the existing fetch fallback unless `fallback:'none'` disables it. QStash cannot carry control responses.

Synchronous HTTP does not automatically retry. Queue replay can issue the request again, and queue transport may redeliver. There is no outbox or exactly-once guarantee. Consumers should handle duplicates using the event's available operation/tool identity and their own business rules; no new request ID or correlation echo is required by this protocol.

## Where notifications add latency

Notification-only describes what the response can do; it does not mean fire-and-forget. These producers await dispatch:

| Position                              | What waits                                                                                                                             |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `beforeCompact`                       | Context compression starts after notification dispatch finishes                                                                        |
| `afterCompact` / `onCompactError`     | The compression result/error path waits before returning                                                                               |
| `beforeCallAgent`                     | Child creation/start waits before it begins                                                                                            |
| `afterCallAgent` / `onCallAgentError` | Returning the child startup result/error waits; this does not wait for child completion                                                |
| Explicit Stop                         | Rows settle, interruption is acknowledged and completion is recorded before direct notification; the Stop request then awaits dispatch |
| Continuation `afterHumanIntervention` | The step lock remains held while each decision group is dispatched and its remaining list is saved, before step processing continues   |

For `delivery:'fetch'`, both local and queue runtimes await the target HTTP response and body or failure. Each endpoint has its own timeout in seconds, default 30. Matching endpoints are dispatched sequentially, so slow endpoints can accumulate that wait; the timeout is not a single budget for the whole event. A selected local in-memory handler is also awaited, but the HTTP timeout does not limit handler execution.

For `delivery:'qstash'`, the producer awaits the QStash publish request, not the target's eventual delivery or response. `timeout` is passed to QStash for target delivery; it is not a guaranteed deadline for the publish call. If publishing fails and fetch fallback is enabled, the producer additionally awaits direct HTTP delivery under the endpoint timeout. All notification responses remain ignored: deny or rewritten input cannot govern these paths. Compression and child-start notification failures retain their producer-specific error isolation despite the wait.

## Approval notification reliability

Modern continuation persists the final decision groups in its host state. Under the existing step lock it dispatches one group, saves the remaining groups, then updates memory. A later group failure does not resend an earlier group whose checkpoint succeeded. Ordinary delivery failures follow the dispatcher’s log-and-consume policy; `fallback:'none'` keeps the failed group pending and propagates `CriticalHookDeliveryError`. The checkpoint is per action group, so partial failure across endpoints can resend an endpoint that already succeeded.

A crash after HTTP delivery but before the checkpoint can duplicate the group. A completed checkpoint prevents ordinary continuation reuse or a replacement worker from resending it. Modern Stop sends directly after atomically saving interrupted status and a pending batch marker on the existing operation. Dispatch returning is followed by owner/batch/status-scoped consumption. A critical failure keeps the marker; the same resolution request retries from persisted host hooks while business status stays interrupted. Missing runtime state or failed consumption is an explicit error, not success. After consumption, normal replay sends nothing. Ordinary notification failure is swallowed and consumed. A crash before dispatch leaves the marker for request-driven retry; delivery before a crash or failed consumption, and concurrent retries, may duplicate it. There is no background Stop retry; the marker is a completion checkpoint, not a delivery lease. Legacy terminal rows without a marker do not reconstruct notifications, and the separate legacy direct approval path can still lose delivery between decision persistence and dispatch. Notification errors do not roll back a completed Stop or decision. There is no guaranteed delivery, outbox or crash exactly-once guarantee. Notification responses, including deny or rewritten input, are ignored.

## Request and response

Requests are JSON POSTs containing the hook event plus `hookId` and `hookType`. Tool events retain `identifier`, `apiName`, and `args`, with native `toolCallId`, execution source/target and available run associations supplied by the integrated producer. Optional associations depend on the actual runtime origin; do not invent parent IDs. Notification `eventFields`/`body` compatibility remains available, but control requests reject filtering or payload overrides. Remote payloads omit `finalState`. Control requests additionally include the immutable `originalArgs` snapshot; ordinary tool notifications do not. Their `args` contain effective inputs.

`userEmail` is optional HTTP-only enrichment after notification projection/static body is applied. It is read from the database only when the final userId matches the event initiator or this dispatch call's trusted runtime owner. A body field cannot authorize another identity or supply its own email, even after cache warming. When eventFields is present it must include userEmail to receive enrichment; omitting userId from that projection uses the event initiator for lookup without adding a userId field. Missing or failed lookups omit email without suppressing the notification. Query timeouts belong to the database; the Hook layer adds no email-query timer or one-second deadline. The per-dispatcher cache holds up to 1000 query Promises for five minutes. Each waiter retains independent AbortSignal cancellation. Control requests use the same enrichment with cancellation and reject body/projection overrides.

The separate L identity/owner candidate c942 (D acceptance f5ad) supplies trusted owner context at the real producers and uses trusted visitorUserId before runtime owner for external event userId. No actorUserId or public owner field is added; execution/permissions/DB owner does not change. This producer follow-up is not merged into the original-stack target above. Its r28 evidence covers six emitted types through programmatic share access, not all16 or public share UI. Static internal callback owner identity remains distinct from the visitor.

Only a `beforeToolCall` webhook with `responseHandling:'toolCall'` interprets this response:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "beforeToolCall",
    "permissionDecision": "allow",
    "permissionDecisionReason": "The operation is permitted",
    "updatedInput": { "path": "notes/example.txt", "content": "Example" },
    "additionalContext": "Use the approved destination for this tool call."
  }
}
```

`permissionDecision` accepts `allow` or `deny`. It is optional. `updatedInput` requires `allow` and replaces the entire input object. `additionalContext` can be supplied without a permission decision and is limited to 10,000 characters. The response body is limited to 64 KiB. Empty successful responses or `{}` mean no decision. Invalid JSON, non-2xx responses, network failures, timeouts and unsupported response fields are protocol failures. The strict schema rejects `ask`, `defer`, whole-run stop and tool-output rewrites; these are not silently treated as supported.

`timeout` is in seconds, default 30. `onError` defaults to `continue`; `block` is available only in control mode. A control hook cannot also have a handler, use QStash, filter event fields or override the payload. Notifications default to `responseHandling:'ignore'`, and their responses cannot change the run. URLs follow existing SSRF protection and private-network policy. Fetch delivery rejects redirects so destination changes cannot leak credentials.

The shared generic source/Review router treats an interrupted operation with a matching pending Stop marker as incomplete dispatch. It preserves the same resolution for retry and publishes completion only after consumption; an unrelated batch marker is a conflict. Custom-cancellation retries repeat the Stop checkpoint, not the marketplace action. Resolutions incorrectly completed by an older version are not automatically reopened.

## Tool control and approvals — acceptance pending

Controls run before permission checks, approval and batch lane planning, and before mock or real effects. Registered controls run in order; the next sees the previous effective input. A deny blocks that tool with zero attempts, without invoking mock, execution billing or tool retry. It does not stop the entire Agent. Allow still respects platform permission checks and human approval.

The same effective input must reach permissions, approval UI, serialized preparation, resource lanes, execution and after-events. Internal tool retries reuse preparation. Approval recovery rechecks from original input; changed effective input invalidates the old approval. Cancellation ends the wait; a late allow cannot start a tool. Both legacy approval resume and modern continuation retain the configured hooks.

Additional context is persisted with the tool record and projected, escaped, into the ordinary tool result for subsequent model input. It is deduplicated by tool row, native tool call and hook; recovery retains prior fragments and replaces a hook's fragment when that hook returns updated guidance. It does not modify stored tool result content or create/edit user or system messages. Denied calls can retain context too. This submitted contract still awaits integrated product verification.

## Events

| Event                     | Meaning                                                                        |
| ------------------------- | ------------------------------------------------------------------------------ |
| beforeToolCall            | Tool preparation; the only HTTP control point                                  |
| afterToolCall             | Final parameters and structured result, including blocked results              |
| onToolCallError           | An actual tool exception, not a hook denial                                    |
| beforeHumanIntervention   | Pending native tool IDs and effective input before approval                    |
| afterHumanIntervention    | Approval/rejection action, reason and affected tool IDs                        |
| onStopByHumanIntervention | Explicit human stop, with the actually stopped pending IDs                     |
| beforeStep                | Step about to execute                                                          |
| afterStep                 | Step content/results and usage statistics                                      |
| onComplete                | Terminal reason, final response, attachments and statistics; not async parking |
| onError                   | Original business error and run association                                    |
| beforeCompact             | Message/token counts before context compression                                |
| afterCompact              | Compression message-group ID, counts and summary                               |
| onCompactError            | Compression's actual error and token context                                   |
| beforeCallAgent           | Parent operation is about to create/start a child                              |
| afterCallAgent            | Child creation/start returned; **not child completion**                        |
| onCallAgentError          | Child creation/start failed or threw                                           |

Every event except configured `beforeToolCall` control is notification-only. A shared-group child may have no isolated `threadId`. Child completion is its own `onComplete`; parent hooks are not automatically inherited by child operations.

Compression notifications are awaited, so a slow receiver adds latency. Notification failure must not roll back compression or alter its retry behavior. Existing critical callbacks with `fallback:'none'` retain critical failure propagation: failure must not recursively alter the business terminal state or emit extra terminal notifications. Error-path state reload may fall back only to the state already loaded within that execution, preserving the original error.

## Coverage limits

The integration covers tools controlled by the server Runtime, including its client/device forwarding paths. It does not instrument an independent client Runtime or tools inside heterogeneous Agents. No global mandatory governance, automatic child inheritance, output rewriting, outbox or exactly-once delivery is provided. Final documentation must be checked against the coordinator's integrated revision and real local/queue/device/Web outcomes before publication.

## Missing approval source state

An approval continuation with an authoritative source operation requires its saved runtime state when creating or rebuilding the continuation. Missing or expired state, or a failed source read, rejects preflight before successor messages, tool discovery or operation creation; it is not treated as an empty hook list. The validated source snapshot is read once and passed to startup. Legacy approval rollback preserves the reviewed tool snapshot. A ready deterministic continuation may reuse its own saved state even if the older source has expired. This does not repair previously created hookless continuations, extend the state TTL, or provide an outbox guarantee.

Stop acknowledgement persists an interruption sentinel and can precede the local AbortSignal. The server now checks that authoritative sentinel around controls, preparation and launch boundaries, including after email enrichment; a visible stop aborts the step, and read failure fails the step explicitly. The two-second poll and one-second optional-email bound remain unchanged. r33 observed the repaired backend path with real Redis/HTTP across processes; historical r29 remains failed evidence. A check and external launch are not atomic: already-started requests/effects cannot be recalled. This is not a Web, signed queue-callback or every-lane cancellation claim.
