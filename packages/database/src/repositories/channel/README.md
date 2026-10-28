# Channel persistence boundary

Channel owns a public collaboration timeline and triggers existing Agent conversations.
This package provides the data contract; it does not activate Channel routers, runtime adapters,
subscriptions or a details UI. Repository transactions lock the `channels` row before coordinating
public messages, deliveries, topics and operations.

## Storage

| Responsibility                                 | Storage                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| Membership, roles, routing, branches, ordering | Channel tables                                                                        |
| Conversation kind                              | `channels.agentId`: bound Agent for a direct conversation; NULL for a group           |
| Message sender                                 | `channel_messages.userId` or `agentId`; never the requesting user on an Agent reply   |
| Public content and replies                     | `channel_messages.content`; independent IDs                                           |
| Public attachments                             | `channel_message_files`, with sender-checked file references and order                |
| Internal conversation                          | Ordinary `topics` and `messages`, with the actual Agent and requester                 |
| CLI resume handle                              | Topic `metadata.heteroSessionId` (not a database topic ID)                            |
| Execution status, errors, usage, traces        | One ordinary `agent_operations` row per claimed job                                   |
| Source relation and coordination               | `channel_jobs.topicId` / `operationId`, input window, FIFO, lease, locks, publication |

There is no `channel_id` on ordinary messages, topics or operations, no public Channel topic, and
no separate Channel session/run/runtime-message store. `trigger='channel'` records the origin of
an ordinary conversation/execution. The job points to it from the source side.

A direct conversation binds `channels.userId` (its human participant) and `channels.agentId`.
`ChannelRepository.create({ agentId, title })` checks Agent access, creates both members atomically,
and requires private visibility. It opens the default conversation: a unique index on Agent, person
and scope keeps one per pair, so repeated or concurrent calls return the existing channel. The scope
is part of the key because a transferred Agent starts a new conversation in its new workspace.
Only that human participant can access it, even if another
membership is accidentally granted. It accepts no additional Agent members and routes unmentioned
messages directly to the bound Agent. Group channels leave `agentId` NULL, including groups with
only one Agent. Deleting a bound Agent cascades its direct conversations and their public history.

Group history survives deletion of an author or Agent. Message sender references use `SET NULL`;
new writes require exactly one actual sender. Human requests have `userId`, Agent replies have
`agentId`; the database forbids mixing these roles. Both references can be NULL only in retained
history through repository writes. The existing `routingStatus='reply'` identifies Agent replies
after deletion; other statuses are human requests. Context authors expose the actual user/Agent ID
(or NULL after deletion) and resolve names from those entities, with deleted-author fallbacks.
Member IDs still identify mentions, Thread followers, requester permissions and execution environments.
The claimed manifest freezes the replying Agent ID so rebinding a member cannot change authorship.

Member, grant, message and job IDs are database-generated UUIDs; message references use UUID
columns as well. Agent members reference `agents.id`; deletion clears that reference and blocks
new claims, retaining group history. Optional `channels.project_id` is cleared on project deletion.
Project association does not grant Channel access. Personal channels and direct conversations,
including workspace ones, are removed with their owner; workspace groups retain their public history
if the creator leaves or deletes their account.

`ChannelRepository.addAgent` requires an admin and a usable Agent in the current scope. The
nullable reference exists for deletion history, not for creating an unbound Agent member. The
member's `config` contains only the Channel device, device owner and working directory. Its name
and description are Channel routing/execution labels; message author names come from the actual sender.

Every claim rechecks the actual requester's Agent access and reads the Agent's current settings.
Configuration uses the same merge function as AgentService: system defaults, server defaults,
personal defaults (personal scope only), then the Agent. Workers must supply trusted
`getServerDefaultAgentConfig()` output in `serverDefaultAgentConfig` (`{}` when unconfigured).
The job's `executionConfig` freezes those settings, the Agent runtime and the Channel environment.
Updating Agent settings affects the next claim, including already queued requests; it never
rewrites an earlier job snapshot. A private, trashed, deleted or moved Agent fails the requester
access check before any topic or operation is created.

## Topic continuation

Every claim reserves a new operation, but normally continues the previous topic for the same
Channel Agent member, branch and requesting member. Requester isolation prevents resuming another
person's credentials or internal context. The last claimed delivery (ordered by `claimedAt`, not request sequence) must have accepted input,
finished successfully and released its writer without revocation/isolation. Publication may still
be pending. Its Agent and execution configuration must still match, and its
topic must exist in the same user/workspace scope and not be trashed.

Like the Discord bridge, the main timeline starts a new topic when the previous topic's
`updatedAt` is more than four hours old. This is checked when the next request arrives; it is not a
timer and does not delete old topics. Channel Threads keep their topic despite idle time. A
request explicitly retried after routing failed may be older than the previous input cutoff; it
starts a new topic instead of inheriting later context. Failed/unknown executions, changed
environments and unavailable topics also start afresh. An adapter's explicit “new conversation”
feature is outside this foundation.

Every dispatch receives only the triggering request, its author and attachment references. Public
history is read on demand through `lobe-channel.readMessages` / `readMessage` in Native runs, or
`lh channel history` / `lh channel message` in external runtimes. A Thread can read the main prefix
through its root plus its own messages; the frozen request cutoff excludes later arrivals. Reads
include published Agent answers, including when continuing a private topic. Existing private
Agent transcripts stay in their ordinary topic and are never exposed through these tools.

`ChannelHistoryRepository` binds reads to the live operation and rechecks requester/Agent membership,
workspace access, thread availability and revocation under the Channel lock. The caller cannot
choose a Channel or Thread. History pages contain at most 20 messages with 2000-character excerpts;
individual messages are read in 12000-character chunks. Names and attachments resolve at read time.
External operation tokens receive `channel:read` only for a reserved Channel dispatch; ordinary
runs and sub-agents do not inherit it.

Pending routing is part of member FIFO even before a job exists. An earlier main-channel
decision blocks later claims until its recipients are known; an earlier Thread decision blocks
only that Thread's following members. Skipped, failed or stopped routing releases this barrier.
Branches opened while their root is pending inherit its eventual responders, preserving explicit
invitations. Their unmentioned replies stay pending until then, including replies sent with the
all-candidate fallback. Stopping a reply still fences it; root completion never revives it.

## Access and runtime integration

- `ChannelRepository` checks membership, role and workspace scope. Future routers must also
  authenticate active workspace membership. Agent configuration, execution permission and device
  grants must be authorized before dispatch; a Channel membership is not Agent authorization.
- Ordinary models keep their existing user/workspace authorization semantics. There are no
  Channel-specific constructors, exclusions from search/memory/sharing, or blanket rejection of
  Channel-triggered operations. Public Channel messages cannot be read through ordinary chat APIs
  because they live in a different table. Workspace model scope alone is not an Agent permission
  check: the eventual details endpoint must authorize the Agent/topic using the existing access
  layer before opening normal topic details. This PR does not introduce that endpoint or grant.
- The public timeline includes only posted messages and selected final replies. Tool calls,
  intermediate outputs and reasoning remain in ordinary conversation storage. Opening details is
  a separate authorized operation, not an expansion of the public timeline.
- Read new input with `ChannelExecutionRepository.input(channelId, jobId)` and pass the claim's
  `topic.id`, actual requester/Agent and `job.operationId` into the existing runtime. Persist the
  internal transcript with ordinary models; never copy all historical Channel input again when
  continuing. CLI adapters resume from `topic.metadata.heteroSessionId`.
- Dispatch with the job's frozen Agent settings and Channel environment, not `member.config` or
  a fresh settings lookup. Device routing and working-directory overrides come from the Channel
  environment whose grant and locks were checked, not the Agent's default device binding.
  Knowledge and file contents still use the ordinary authorized runtime loaders; they are not
  copied into this settings snapshot.
- Call `recordStart` for the reserved idle operation before acknowledging dispatch. Only an exact
  user/workspace/topic/Agent match may initialize it. Repeated starts cannot overwrite running or
  terminal executions. The runtime remains responsible for normal topic activity updates.
- Acknowledgement records input acceptance; the ordinary runtime owns session metadata. Save the
  final answer once, then publish its text to `channel_messages`; publication is idempotent and
  cannot publish a revoked delivery.
  Public attachment uploads are authorized and locked before association. Generic file cleanup
  preserves files still referenced by Channel messages.
- Job status describes the Channel delivery; execution status/errors/usage live on its operation.
  Operation completion is not proof that a device process ended. Only `releaseWriter` after
  confirmed termination, or `retireReservation` for an untouched operation, releases the writer.
  Isolation frees the member but keeps the device/directory lock. Never retry an unknown delivery.
- Existing hard-delete paths already reach Channel rows: Agent deletion (including trash purge,
  session and group deletion) cascades direct conversations, `UserModel.deleteUser` removes
  personal channels and direct conversations, and workspace deletion cascades every channel in it.
  Cascades do not stop external processes. The integration's `channel_preserve_active_writer`
  database trigger rejects any job deletion while `writer_held` is true, including cascades.
  Stop replies and confirm physical termination before retrying the deletion. This prevents
  existing deletion paths from silently dropping a live directory lock; it does not automatically
  stop external processes on behalf of a destructive operation.
- Deleting a Channel deletes its jobs/public history, not ordinary conversations or execution
  records. Deleting a topic/operation clears the corresponding job reference; it does not delete
  the Channel timeline or release an unconfirmed writer.

## Migration and verification

`0184_channel_tables` is the foundation migration already on `canary` and must remain unchanged.
It creates Channel tables and references existing Agents, topics, operations and files; it does
not add columns or indexes to the ordinary chat tables. The integration adds the active-writer
deletion guard in `0187_channel_preserve_active_writer`, so databases that already applied the
foundation receive the guard too. Both migrations are applied by the normal deployment runner;
no separate online index step is needed for existing chat tables. Defensive DDL permits replay
of this exact schema, not conversion from earlier development-only versions. A separately
deployed prototype needs an explicit inventory and conversion plan before cutover.

Focused integration tests cover storage separation, ordinary access boundaries, attachment
retention, continuation/expiry, request-only input, bounded history reads, routing, stops and writer locks. Run with PGlite
and with PostgreSQL (`vitest.config.server.mts`); the two concurrent claim/sequence tests require
real PostgreSQL row locking. Runtime and UI integration require separate product acceptance;
storage tests alone do not verify the user-visible Channel flow.
