# MCP elicitation

This package adapts the installed MCP SDK 2.4 client without enabling automatic
fulfilment, sampling, roots, or tasks. It preserves SDK tool header mirroring and
output validation. Its protected non-complete-result hook retains the full
`input_required` checkpoint; the SDK's ordinary unsupported-result exception
only preserves the result type and method.

- **2026-07-28 HTTP:** return the call stack to the host with opaque `requestState`
  and optional keyed `inputRequests` (a requestState-only wait stays pending and cancellable). On user resolution, issue the original tools/call
  parameters with a fresh transport request id, exact requestState and bare keyed
  inputResponses. A later round replaces the intervention batch. URL accept is
  consent, and the server determines whether the external operation has finished.
- **2025-era HTTP and stdio:** answer elicitation/create on the original live
  protocol connection. A session serializes uncorrelated legacy invocations and
  incoming requests. On connection loss or deadline, retire that session before
  another queued invocation can start. Only calls proven not to have reached the
  wire may acquire a fresh session automatically.
- **Legacy URL-required (-32042):** retain the original operation, show the URL's
  elicitationId-correlated request, and retry only after explicit user continuation.
  Decline/cancel settles without retry. Completion notifications do not themselves
  imply a tool result or authorize an external page to open. Modern URL requests
  use requestState and do not have the legacy elicitationId.

The server host uses existing agent intervention sealed batches, first-winner
resolution outbox, custom execution fences, tool message anchors, async-tool
barrier and after-tool result controls. A resolution mutation queues only outbox
identity. The worker reads form answers privately and parks each further round.
The original user, workspace, assistant, operation and tool call are checked before
reading or resolving a request. A parked HTTP continuation also pins its connection
and rechecks current installation/tool permission. Identical resolution retries
are idempotent; changed answers or stale batches conflict. An expired execution
lease has an unknown remote outcome and is settled as an error, never replayed.

Desktop main uses the same host contract through the authenticated server. Device
Gateway forwards that invocation's identity and fixed deadline. Direct IPC results
can be delivered from main without a live renderer. Live legacy/native producer
sessions survive page navigation and renderer closure; destruction of the producer
process cannot restore a legacy protocol session and produces a bounded failure.
Modern server checkpoints can resume in a new worker. Deadline callbacks expire
unanswered or abandoned requests and return a failure receipt to the parent.

Form rendering supports the official flat JSON Schema subset, defaults, required
values, booleans, string/number/integer bounds and formats, old/new single-choice
labels, and enum multi-choice. Both host and client validate accepted content.
Remote descriptions are plain text; secrets are rejected in forms and URL mode
opens only after an explicit user action. HTTP URL targets are limited to loopback;
external targets require HTTPS. No external page is embedded or prefetched.

Protocol references:

- <https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28>
- <https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation>
- <https://github.com/modelcontextprotocol/typescript-sdk/tree/main/examples/elicitation>

Client-runtime MCP batches enter the existing persisted approval-continuation path
before the first tools/call. The original assistant and tool rows remain their
authority; the replacement operation records exact source rows before dispatch.
This uses the configured Agent Gateway for delivery, including local Desktop IPC,
and the same durable worker/outbox for subsequent HTTP rounds. Installed/custom
HTTP and stdio plugins retain their server-owned connection settings on this path.

Producer ownership, completion queues, first delivery, native invocation lookup and
message anchors share one user/workspace/operation/assistant/provider-call tuple.
Manual bearer/header credentials and stable OAuth client/issuer configuration are
privately hashed; only configured OAuth refresh-token rotation is exempted.
