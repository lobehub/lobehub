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
- **Muted** (`channel_members.config.muted`, `channel.setMemberMuted`, admins only): the member is
  not a candidate at all. Only an @mention reaches it: not routing, the paired-Agent shortcut, the
  all-candidate fallback or a reply to its message; it cannot post on its own either. Muting stops
  its open jobs. The Agent of a direct conversation cannot be muted.
- **Quiet**: the member stayed silent `maxSilentWakes` times since it last answered; routing may still
  choose it, but not wake it on a hunch.

One member woken by its own rules gets the message. Several are arbitrated by the decision model:
any that is not a confident no is kept, woken for its own reason, and the most likely one leads
(see [One primary responder](#one-primary-responder)). When no member's rules claim the message,
the decision model chooses among the eligible members, as below. A member woken by its own rules,
or one the model was unsure about, is a `followup` wake (`channel_jobs.wake`): its prompt ends with
a `channel_wake` block, and it may answer `NO_REPLY`, which settles the job as `silent` instead of
failing it. The member the model chose to lead owes an answer.

### One primary responder

An unaddressed message has exactly one primary responder; every other member woken for it is a
`followup` deferred behind it (`channel_jobs.wake.afterMemberId`):

- Decision model: the most likely member at or above 0.7 leads and owes an answer. Other members
  at or above 0.7 follow as `routing-deferred`, uncertain ones as `routing-uncertain`.
- Members' own rules: several members named in the text are led by the one named first; claims the
  model arbitrated are led by the most likely. Without a usable model answer (disabled, failed),
  the member the person was just talking to (`followup-window`) leads, then one whose duties
  cover it, then candidate order. A primary woken by its own rules keeps its own `followup` wake.
- Explicit @mentions are unchanged: every mentioned Agent owes an answer and runs in parallel.
  So are the paired Agent of a one-person group and the all-candidate fallback.
  Agents @mentioned together answer in one shared Thread under the request: the first opening
  that chooses a Thread opens and names it, every later acknowledgement and answer joins it, and
  each run's opener and prompt (`channel_peers`) name the others so they take their own part.

A deferred job is queued as `awaiting_primary` and the claim keeps it there until the primary's
job settles (completed, silent, failed or cancelled), or the primary is stuck on a device or a
person (`device_*`, `unavailable`, `workspace_changed`), in which case it runs without waiting.
It then runs normally: its prompt carries the primary's published reply as a `channel_reply`
block after the request (`manifest.primaryReplyMessageId`; the history cutoff stays at the
request) and a `channel_wake` hint to stay silent if that reply already covers the request, or
add only what is distinct. Clients do not count an `awaiting_primary` job as a reply in progress.
`routing_decided` details record `primaryMemberId` and `deferredMemberIds`; each woken member's
decision row records `responder: primary | deferred`.

Owner presence and stand-down have no Channel equivalent and never fire. The classifier and duty
judge run as the sender, with the deployment's bot-wake model, under a shared hourly budget per
channel (`CHANNEL_WAKE_MODEL_CALLS_PER_HOUR`); a failed or over-budget call is not a yes. They run
for all members in parallel before the decision model's deadline starts. If arbitration fails or
returns an unusable answer, the members' own wakes still stand. A follow-up whose run stopped on a
tool call (out of steps) fails; only a chosen silence, or no output at all, settles as `silent`.

### Configuring and auditing it

`channel.wakeConfig` reads the stored strategies and `channel.updateWakeConfig` replaces the
channel's, or with `memberId` one member's (`null` resets to the defaults). Admins only. Input is
validated strictly by `WakeConfigInputSchema`, the shape the bot settings parse, without a scheduler.
A member's strategy lives beside its environment in `channel_members.config`; replacing either
keeps the other.

Every routed (non-fallback) message records one `signal_decisions` row per judged member, through
the same `recordSignalDecision` as IM bots: source `lobehub`, type `channel.message.routed`,
pipeline `channel-wake@1`, scope `lobehub:<channelId>:<memberId>`, filed under the member's Agent
owner in the channel's workspace. Verdicts are the member's own rules plus the decision model's
answer (`channel:routing`). `channel.listWakeDecisions` pages them in the bots' wake-record shape.

## Decisions and recovery

A single `ModelRuntime.decide()` call asks a boolean question per eligible member. Probabilities
at least 0.7 select a member; probabilities at most 0.3 exclude them. A member between 0.3 and 0.7
(exclusive) that is not quiet follows a selected primary as a deferred `followup`. When nobody
reaches 0.7, only the most likely such member is woken, as a `followup` that may stay silent.
All confident negatives still produce `skipped`.
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
`channel.retryJob({ channelId, jobId })` lets the requester/admin run a failed reply again from
the start; it waits for its device like any queued reply. `channel.resumeJob({ channelId, jobId })`
runs it again in the topic it stopped in, so a CLI Agent resumes its session
(`topic.metadata.heteroSessionId`); the run gets the request with a short continuation block
(`channel_resume`) instead of the full context.

A reply that fails for a system reason (error, interruption, the inactivity watchdog, a
dispatch or device failure, a run that ended without text) gets a card in the Agent's reply slot,
not a job-level note only. `reportChannelReplyFailure` (`replyError/`) posts a rule-based card per
failure kind right away, in the requester's language, then lets the deployment's mini model
(`channel_reply_error` tracing scenario, 10 s budget) rewrite the sentence and order the allowed
actions in place. A shared Agent's card keeps the visitor-safe error projection and gets no model
rewrite. A stop through the Channel cancels the job and writes no card. The job's own
`errorMessage` / `errorType` / `deviceId` stay in the detail view for older clients.

Each member answers a branch in message order, but not one run per message: when a job is
claimed, the same person's owed answers queued right behind it from that member in that branch
are merged into the run (`claim.ts`, `merge.ts`). The manifest's cutoff and `requestMessageId`
move to the newest of them and `requestMessageIds` lists them all; their jobs settle as `merged`,
and only the first opens a reply. Merging stops at someone else's request, a `followup` wake, a
relay or brought-back answer, or a message whose routing is still undecided, and never applies
to a shared Agent, whose visitors are metered per request. Retrying the run re-queues them.

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

When more unseen messages exist than the five sent, a `channel_gap` block before them says how many
were left out, so the model reads the history instead of guessing. A context message the member
published itself is marked `self="true"`.

### Conversation identity

A responder keeps one topic per requester and branch (the main timeline, or a Thread). The
requester is the run's execution identity: their credentials, devices and tool results end up in
that topic, so a topic is never shared with another requester's runs. What the member did for
other people reaches it only as public replies, which the prompt marks `self` so the member
recognises its own earlier work instead of treating it as someone else's.

### Why the Channel instructions stay in the system role

`CHANNEL_INSTRUCTIONS` is constant text appended to the native run's system role, so it is already
stable and prompt-cacheable; everything that changes per run (recent context, the gap, the wake)
is in the request prompt. Moving it into a context-engine provider like the bot platform context
would mean threading a Channel flag through the server context snapshot, `@lobechat/mecha` and the
messages engine for no change in what the model sees. External runtimes keep getting it in
their system context from `heteroDispatch/prepare.ts`.

### Messaging Agents in other Channels

A Native run can also reach Agents outside its Channel, so "tell / ask that Agent" is a message
the Agent decides on, not a task created for it. `lobe-channel.listChannels` lists the requester's
active Channels (archived and trashed ones are left out) with their active Agent members.
`lobe-channel.sendMessage` posts into one of them through `ChannelService.send`, @mentioning the
chosen Agents (`ChannelMessagingService`).

- **Who sends it.** The run's requester is the sender and execution identity, as if they had
  posted it, so the target Channel's membership, routing and Agent permissions apply unchanged.
  A Channel message has exactly one sender and an Agent-authored row is always a `reply` that
  routes nowhere, so the relaying Agent is recorded in `metadata.via` instead. The timeline shows
  "Relayed by", and the woken run sees a `via` attribute on its `channel_request`.
- **What it may do.** Every call first passes the same live-run check as a history read
  (`ChannelHistoryRepository.currentRun`). The target must be one of the requester's Channels and
  each `agentId` an active member there; at most five Agents, never the sender itself or the
  Channel it is answering in (its final answer is posted there).
- **One hop.** A run answering a relayed request cannot relay again, so two Agents cannot keep
  waking each other on the requester's behalf.
- **Retries.** The request key is `agent-relay:<operationId>:<toolCallId>`, so a retried call
  returns the message already posted.
- **Where the answer goes.** The addressed Agent answers in its own Channel, and the tool returns
  a link to it for the relaying run's final answer. When that reply is published,
  `deliverRelayReceipt` (called from `ChannelCoordinator.complete`) posts it back into the Channel
  and branch the relay came from (`metadata.via.origin`), as the same requester, @mentioning the
  relaying Agent. That receipt carries `metadata.receipt` (the answering Channel and reply) and the
  answering Agent in `via`. The timeline shows "<Agent> replied in #<Channel>", and the woken run
  sees `via` and `reply_from` on its `channel_request`. Because the receipt has `via`, the run it
  wakes cannot relay again: one hop each way. The receipt is best-effort: a relaying Agent,
  Channel or branch that is gone, or a requester who left, gets none. It is keyed by the reply id,
  so a repeated completion posts it once.
- **One Agent is asked between the two Agents.** The relay above is only for several Agents
  addressed together in a group. A Channel run addressing one Agent never relays, whichever
  Channel it named or none: a relayed request lands in a group or the person's conversation as
  the person, and its receipt occupies the channel they use to talk to their Agent. The Agent is
  located through the requester's Channels, its own conversation first (`findAgent`). A bot run
  has no Channel for the conclusion to come back to, so it still relays.
  `askAgent` instead opens the conversation between the two Agents (`channels.agentPairKey`, one
  per pair, person and scope), giving each Agent the environment it has where the person already
  talks to it. The asking Agent writes the request itself (`channel_messages.agent_id` on a
  request); the person is the owner member, the requester and the execution identity, and only
  watches. The request is not a relay and carries no `via`: `metadata.exchange` keeps the origin
  and `hops`. When the other Agent's reply is published,
  `ChannelExecutionRepository.deliverAnswerToAsker` queues the asking Agent on that reply in the
  same conversation; that run's `currentRun().exchange` names the origin. Its own reply answers a
  reply, so it wakes no one, and `reportAgentExchange` posts it where the asking began as the
  Agent's own message (`postAgentMessage`, with `metadata.receipt` linking back and naming the
  answering Agent in `receipt.agent`; the timeline shows a "Messages from <Agent>" line above it). Asking again
  from that run continues the exchange (`hops + 1`) up to three asks; the answering Agent's run (`requestByAgent`) cannot pass the question on. `deliverRelayReceipt` skips Agent-written requests.
- **@mentions in replies.** An Agent's published reply has its `@Name` text turned into real
  mentions (`ChannelExecutionRepository.deliverReplyMentions`, called from
  `ChannelCoordinator.complete`): the reply is parsed as Markdown (remark + GFM) and only its
  text nodes are matched against active members, like the timeline highlight. Code, link and
  image destinations, HTML and an autolink's own address never count; the replying Agent itself
  is skipped. People are notified; each mentioned Agent is queued on the reply for the same requester and follows the Thread. The reply records the
  Agent-to-Agent hops since a person spoke (`metadata.mentionHops`); past
  `MAX_REPLY_MENTION_HOPS` (3) the mentions are still recorded but wake no one. A conversation
  between two Agents only records them; its exchange has its own limit.
- **External runtimes.** `lh channel list` and `lh channel send` call the same service through
  `channel.listChannels` / `channel.sendMessage`, authorised by the run's operation token with
  the `channel:message` capability that every Channel dispatch is minted alongside
  `channel:read`. The CLI's `--request-key` (random by default) is the retry key.

### Messaging people for the requester

"Let Alice know when you are done" is a message to a person, not a request for an Agent.
`lobe-channel.listPeople` (`lh channel people`) lists who the requester can talk to one-on-one in
the run's scope (`AddressBook.listPeople`, a business slot that lists nobody by default). `lobe-channel.messagePerson` (`lh channel dm`)
posts into the requester's conversation with that person (`ChannelService.openPeer`, opened on
first use) through `ChannelService.send` (`ChannelMessagingService.messagePerson`).

- **Who sends it.** The requester, with the writing Agent in `metadata.via`, like a relay: the
  timeline shows "Relayed by". The conversation between two people decides who can be reached
  (`requirePeerRelation`, checked on opening and on every send), so an Agent reaches exactly the
  people its requester could message by hand. A conversation the requester trashed is refused.
- **Notification.** It is an ordinary message there, so `notifyChannelDirectMessages` notifies the
  person as of any message from the requester.
- **Nothing comes back.** No Agent is in that conversation; the `via` has no `origin`, so no
  receipt is delivered. Unlike `sendMessage` there is no hop rule: a person does not wake anyone.
- **Retries.** The request key is `agent-dm:<operationId>:<toolCallId>` (or `cli:<requestKey>`).
- Shared-Agent runs do not get it: the share gate allows only history reads.

### Why history reads stay on `lobe-channel`

`lobe-message.readMessages` reads a bot platform by model-supplied `platform` / `channelId`
arguments, authorised by the bot's platform credentials. `lobe-channel` history reads take no ids
from the model: every read is scoped and re-authorised by the run's frozen manifest (branch,
cutoff, membership, live operation). `sendMessage` does take a Channel id, but only one the
requester is a member of, posted as the requester. Folding Channel into `lobe-message` would either weaken that to
model-chosen ids or add a second authorisation mode to a tool built around the first, so the two
stay separate and share only the model-facing projection.
