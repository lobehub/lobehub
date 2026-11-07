# Channel responder routing

Unmentioned group messages can use a decision model to choose Agent **members**, not replace
their configured reply models or runtimes. Explicit mentions, bound direct conversations and
groups whose only active members are one person and one Agent still bypass classification; in
the latter, every message from that person, including Thread replies, goes to the Agent. Agent
replies never trigger another classification.

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

## Members' own rules, then the decision model

An unaddressed message is judged bottom-up first: every eligible Agent member runs the same wake
pipeline an IM bot runs (`services/conversationWake`), on state read from the Channel. Its rules
come from `channels.config.wake` with the member's `channel_members.config.wake` over it (nested
groups merge field by field), parsed by the shared bot-wake schema.

- **Named in the text** (`named-in-text`): those members are woken, and nothing else is asked.
- **Follow-up window**: the member answered this person here within `windowSeconds`; the addressed
  classifier must confirm the message is for it.
- **Duties**: the member's duty text covers the message, scored by the duty judge.
- **Excluded**: scope `none`, a channel list that leaves this conversation out, or `bot-threads`
  in the main channel (it still follows up there, and is chosen normally in a Thread it follows):
  the decision model never chooses the member either. An unnamed member's generic `Agent` label
  is not a name the text can call.
- **Quiet**: the member stayed silent `maxSilentWakes` times since it last answered; routing may still
  choose it, but not wake it on a hunch.

One member woken by its own rules gets the message. Several are arbitrated by the decision model:
any that is not a confident no is kept, woken for its own reason. When no member's rules claim the
message, the decision model chooses among the eligible members, as below. A member woken by its
own rules, or one the model was unsure about, is a `followup` wake (`channel_jobs.wake`): its
prompt ends with a `channel_wake` block, and it may answer `NO_REPLY`, which settles the job as
`silent` instead of failing it. A member the model chose owes an answer.

Owner presence and stand-down have no Channel equivalent and never fire. The classifier and duty
judge run as the sender, with the deployment's bot-wake model, under a shared hourly budget per
channel (`CHANNEL_WAKE_MODEL_CALLS_PER_HOUR`); a failed or over-budget call is not a yes. They run
for all members in parallel before the decision model's deadline starts. If arbitration fails or
returns an unusable answer, the members' own wakes still stand. A follow-up whose run stopped on a
tool call (out of steps) fails; only a chosen silence, or no output at all, settles as `silent`.

## Decisions and recovery

A single `ModelRuntime.decide()` call asks a boolean question per eligible member. Probabilities
at least 0.7 select a member; probabilities at most 0.3 exclude them. A member between 0.3 and 0.7
(exclusive) is woken as a `followup` that may stay silent, unless it is quiet; the others are
unaffected. All confident negatives still produce `skipped`.
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
token count, latency, and each member's own rule verdicts (`wakeRules`). No raw provider errors are stored. Runtime hooks still receive
`trigger: channel`, the message ID and attempt for billing/routing observability.

## Responder context

Responder dispatch sends the current request, its explicit quote, and at most five recent public messages the
responder's topic has not seen. Native agents receive the hidden `lobe-channel` builtin for anything
older; external agents can call `lh channel history --json` and `lh channel message <id> --json`.
Both use `ChannelHistoryService`, with operation identity supplied by the runtime, never model
arguments. Reads are bounded, paginated and fixed to the request cutoff and current branch.
`readMessage` expands long text and resolves shared attachment URLs. Membership removal, archive,
revocation or operation completion prevents subsequent reads. The routing classifier's bounded
history above remains separate from the responder's on-demand context.

Public replies refer to participants by display name and to history by content, not internal
sequence numbers or IDs. The shared Channel instructions apply to native and external runtimes,
including when old replies already contain metadata. Explicit, authorized technical questions
can still receive IDs, paths or code relevant to the request.

The request prompt is tagged text, not JSON: `channel_message` blocks for the recent context,
an optional `channel_quote` block, and one `channel_request` block, attributed by display name and type.
The quote retains up to 6000 characters and is omitted from the recent blocks to avoid duplication.
Each tag carries a random
per-run `boundary`, so a tag quoted inside message text cannot close a block or forge an author.
It omits ids, except on a context excerpt that is truncated or has attachments, and sequencing and
branch-control fields. Builtin tool `content` and CLI
history output share a model-facing projection that keeps attribution, message/attachment
references and continuation cursors but omits per-message sequence/thread IDs and the cutoff.
The API and builtin `state` retain the original history for UI/debugging; authorization and
pagination still use the frozen manifest. Native Channel runs also skip unsolicited
`available_agents` inventory, without disabling self-management or explicit discovery tools.
