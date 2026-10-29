# Channel responder routing

Unmentioned group messages can use a decision model to choose Agent **members**, not replace
their configured reply models or runtimes. Explicit mentions and bound direct conversations
still bypass classification. Agent replies never trigger another classification.

## Enable

Configure a TypeSafe API key through the deployment's \`TYPESAFE_API_KEY\` environment variable,
or in the sender's provider settings (workspace provider settings in workspace scope).
Routing is enabled by default. Configure its switch and decision model in Settings → Service Models → Advanced → Channels:

```json
{
  "systemAgent": {
    "channelRouting": { "enabled": true, "provider": "typesafe", "model": "jev-1.14.0" }
  }
}
```

Alternatively set the deployment service-model override:

```sh
SYSTEM_AGENT="channelRouting=typesafe/jev-1.14.0"
TYPESAFE_API_KEY="your-typesafe-api-key"
# With an OpenRouter provider/key:
# SYSTEM_AGENT="channelRouting=openrouter/typesafe/jev-1.13"
```

The service-model switch controls routing; `enabled: false` opts out even when the deployment
sets a model. The default is enabled; `SYSTEM_AGENT=default=...` never fills this non-chat slot.
When disabled at send time, the existing all-candidate fallback remains. A message already waiting
for model classification when routing is disabled becomes unassigned rather than broadcasting.
An unmentioned Thread reply waits for its root's routing decision before choosing candidates;
if sent with fallback, it retains fallback after that wait. Root responders join the Thread
without removing explicitly invited members, and a completed decision immediately wakes deferred
replies. A stopped reply is never revived by root completion.

## Decisions and recovery

A single `ModelRuntime.decide()` call asks a boolean question per eligible member. Probabilities
at least 0.7 select a member; probabilities at most 0.3 exclude them. If every answer is valid
but any probability is between 0.3 and 0.7 (exclusive), select **all eligible members** instead
of leaving an uncertain request unanswered. All confident negatives still produce `skipped`.
A missing/refused answer, invalid probability or provider failure leaves the message unassigned,
even when another answer is uncertain. These thresholds are policy defaults, not a claim of
measured accuracy; calibrate them with actual Channel conversations.

Only public Channel history is used: up to 20 preceding messages, 1500 characters each, respecting
the Thread prefix and request cutoff. Candidates include member labels, Agent descriptions and
model references, never private Agent transcripts, system prompts, tool results, credentials or
local working directories. More than 20 candidates, an empty/attachment-only request or a request
over 12000 characters requires an explicit mention instead of guessing from truncated input.

The provider is initialized as the actual sender with the Channel workspace. Client-only providers
are refused. Routing has a 10-second deadline and aborts on timeout. It does not fall back to chat
generation or wake every member on failure.

The indexed `routing_started` audit receipt leases a message attempt for 60 seconds under the
Channel lock. Model IO runs outside the transaction. Recovery bumps the attempt; stop/retry also
fence late results. The existing `resolveRouting` transaction alone creates idempotent deliveries.
Before starting a delivery, the repository also waits for any earlier pending routing that could
select that member. Explicit mentions cannot overtake those decisions; unrelated Thread members
and other Channels remain independent. A failed, skipped or stopped decision releases the wait.
`channel.retryRouting({ channelId, messageId })` lets the author/admin retry an unassigned message;
sending a new message with an explicit mention remains available.

`routing_decided` audit details record the model/provider, prompt version, scenario, probabilities,
token count and latency. No raw provider errors are stored. Runtime hooks still receive
`trigger: channel`, the message ID and attempt for billing/routing observability.

## Responder context

Responder dispatch sends only the current request. Native agents receive the hidden `lobe-channel`
builtin; external agents can call `lh channel history --json` and `lh channel message <id> --json`.
Both use `ChannelHistoryService`, with operation identity supplied by the runtime, never model
arguments. Reads are bounded, paginated and fixed to the request cutoff and current branch.
`readMessage` expands long text and resolves shared attachment URLs. Membership removal, archive,
revocation or operation completion prevents subsequent reads. The routing classifier's bounded
history above remains separate from the responder's on-demand context.

Public replies refer to participants by display name and to history by content, not internal
sequence numbers or IDs. The shared Channel instructions apply to native and external runtimes,
including when old replies already contain metadata. Explicit, authorized technical questions
can still receive IDs, paths or code relevant to the request.

The request prompt omits sequencing and branch-control fields. Builtin tool `content` and CLI
history output share a model-facing projection that keeps attribution, message/attachment
references and continuation cursors but omits per-message sequence/thread IDs and the cutoff.
The API and builtin `state` retain the original history for UI/debugging; authorization and
pagination still use the frozen manifest. Native Channel runs also skip unsolicited
`available_agents` inventory, without disabling self-management or explicit discovery tools.
