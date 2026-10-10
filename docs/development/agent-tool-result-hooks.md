# Controlling tool results with afterToolCall

`afterToolCall` can synchronously decide whether a completed tool result may enter the next model turn. It uses the same flat HTTP allow/deny protocol as `beforeToolCall`.

This is a **result gate**. The tool has already executed, so denying its output does not undo file writes, network requests, child-agent work, or messages already posted to a shared conversation.

## Register a result control

```ts
const hooks = [
  {
    id: 'check-tool-result',
    type: 'afterToolCall',
    matcher: '^files/readFile$',
    webhook: {
      url: 'https://example.com/tool-policy',
      delivery: 'fetch',
      responseHandling: 'toolCall',
      onError: 'block',
      timeout: 5,
    },
  },
];
```

The webhook receives the normal tool correlation fields (`operationId`, native `toolCallId`, `assistantMessageId`, tool identifier/API, effective `args`, and available run context) plus `mocked` and `result`. For controls, `result` is the complete result returned to the server runtime, including content, error/state, execution timing, and Work-registration intent. It is sent **before** content truncation, archival, and observation-event redaction. The policy receiver is therefore a trusted destination for the original result, including any sensitive data it contains.

Reply with HTTP 200 and either:

```json
{ "decision": "allow" }
```

```json
{ "decision": "deny", "reason": "Result is not suitable for the model" }
```

Only `decision` and an optional string denial `reason` are parsed. Extra fields are ignored; controls cannot replace results, rewrite arguments, or append model context. Controls require fetch, cannot also have a local handler, and cannot filter or override their request with `eventFields` or `body`.

Matching controls run in registration order. A deny stops the remaining controls for that result. With no matching controls, normal behavior is unchanged. Ordinary `afterToolCall` handlers/webhooks remain notifications; their returned bodies do not control execution.

## Denial and failure behavior

- Allow continues the existing archival, persistence, streaming, and model-context flow
- Deny replaces the complete result with `Tool result withheld by afterToolCall hook.`, `error: 'hook_denied'`, and a neutral blocked state tagged `phase: 'afterToolCall'`. The original content, error, images/state, archive references, and Work-registration intent are not passed onward
- The receiver's denial reason is deliberately not echoed into model context or tool state, because it could quote the denied output
- The native call/result pairing remains intact. A deny does not retry the tool or charge it as an unexecuted call; actual attempt count, execution time, and existing tool charges remain. Deferred child usage counters are retained without child output
- Result controls run after the tool's existing internal retry loop and also inspect failed/timeout results. Exceptions that do not produce a result retain the existing `onToolCallError` behavior
- Non-200 responses (including 204), invalid/missing decisions, oversized/malformed responses, network failures, and timeouts use the existing `onError` policy: `continue` by default, or `block` for fail-closed operation. Cancellation never becomes permission to release a result
- Denied results are persisted in sanitized form, so later history rehydration cannot recover their original content or state. Deferred completion replays cannot overwrite an already withheld result, even if the hook is later removed

## Server environment configuration

The existing `AGENT_HOOK_WEBHOOK_URL`, `AGENT_HOOK_WEBHOOK_TOKEN`, `AGENT_HOOK_WEBHOOK_EVENTS`, and `AGENT_HOOK_WEBHOOK_ON_ERROR` settings are reused.

`AGENT_HOOK_WEBHOOK_RESPONSE_HANDLING` selects which configured events are controls:

| Value                          | beforeToolCall | afterToolCall |
| ------------------------------ | -------------- | ------------- |
| `ignore` (default)             | Notification   | Notification  |
| `toolCall` (existing behavior) | Control        | Notification  |
| `toolResult`                   | Notification   | Control       |
| `toolCallAndResult`            | Control        | Control       |

Only events listed in `AGENT_HOOK_WEBHOOK_EVENTS` are enabled. A control mode requires at least one corresponding event; unsupported values and incompatible configurations fail validation. Other lifecycle events remain notifications. The environment mode names are intentionally distinct from the per-hook registration's `responseHandling: 'toolCall'`, which identifies the shared decision protocol.

For after-only fail-closed checking:

```dotenv
AGENT_HOOK_WEBHOOK_URL=https://example.com/tool-policy
AGENT_HOOK_WEBHOOK_TOKEN=your-server-side-token
AGENT_HOOK_WEBHOOK_EVENTS=afterToolCall
AGENT_HOOK_WEBHOOK_RESPONSE_HANDLING=toolResult
AGENT_HOOK_WEBHOOK_ON_ERROR=block
```

Existing deployments using `EVENTS=beforeToolCall,afterToolCall` with `RESPONSE_HANDLING=toolCall` keep their original behavior; after notifications do not silently become result controls. All executing server/worker processes need the intended configuration. Environment hooks continue to use current process configuration rather than persisted copies.

## Publication, configuration lifetime, and rollout

A result remains in memory while its hook runs. The runtime then writes either the allowed result or the sanitized denial, before streaming or loading the next model context. Message history reads the stored result directly; there is no persisted pending/allowed/blocked review marker and no result-review projection.

Human-answer source adapters only claim the decision and retain the answer in their private resolution/outbox. `MessageModel.resolveHumanApproval` defaults to claim-only; the runtime opts into `publishResult: true` after the hook returns, atomically writing content, error, and state. An already claimed answer follows the same publication path. Failed writes can retry; failed continuation startup restores the original approval snapshot. Cloud overrides must obey this claim-before-publication contract and must not write raw answers through other message APIs.

Caller webhook configuration stays on the private durable operation record in its existing serialized template format, so a cold worker can recover it after Redis expiry. The existing approval intervention and deferred callback identify the original operation; no additional message review metadata is needed. Environment hooks always come from the executing worker's current environment. After approval or deferred completion, evaluate each operation's caller hooks in order, followed by current environment hooks once. Caller hook IDs are scoped to their operation; identical IDs across operations do not deduplicate policies. Environment-only hooks do not require durable operation storage. Removing an environment hook stops it controlling future results; no matching control means allow. Newly configured environment hooks affect subsequent evaluations. Configured hook delivery failures follow `onError`; caller-policy storage failures propagate for retry.

Deferred completions write into the existing empty tool placeholder once. Later callbacks cannot replace its first final result, including a denial after the hook has been removed. This uses ordinary completion idempotency, not a persisted policy verdict. Receivers should still tolerate repeated control requests.

Roll out updated code and the claim-only source-adapter contract to all executing workers before enabling result controls. Results already published cannot be retroactively withdrawn.

## Execution boundaries

Controls cover the server runtime's ordinary and batched tools, local mocks, gateway-dispatched client/device results, and returned failures. Deferred child-agent results and isolated group-member result anchors and member startup failures are checked before their completion backfills, using the parent tool request and each destination `toolMessageId`. A multi-member call can therefore produce a control request for each result anchor and another for its final group receipt. Re-delivery may repeat a control request; receivers should be idempotent. Human tool-answer continuations are checked before loading the next conversation history, including already-claimed source resolutions.

These are server-runtime hooks. The legacy in-browser `ClientToolTransport` and independently running heterogeneous CLI agents do not acquire a server webhook dispatcher through this change. Gateway mode requires a configured `agentGatewayUrl`, enabled gateway mode, and no per-agent/user `disableGatewayMode` override. Do not put server webhook credentials in the browser.

The gate is not a general-purpose chat/UI/log redaction system. Previously published group-member messages, child-agent history, files already created by a tool, and independent copies of data are outside the withheld tool-result boundary. A later tool read is a new call and must be covered by the desired matcher/policy as well.
