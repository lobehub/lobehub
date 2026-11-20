import type { LobeAgentAgencyConfig, LobeAgentConfig } from './agent';
import {
  LocalExecutionHeterogeneousAgentTypeSchema,
  REMOTE_HETEROGENEOUS_AGENT_CONFIGS,
} from './agent/heterogeneousAgent';
import type { ContactCard, ContactCardType } from './contact';
import { getWorkingDirEffectivePath } from './device';
import type { BotWakeKind } from './signal';
import type { ExternalWorkSummaryItem } from './work';

/**
 * Channel: a shared conversation where people and Agents talk together.
 *
 * Public content lives in channel_messages. Channel jobs trigger ordinary Agent topics
 * and operations; the internal transcript stays separate from the public timeline.
 */

/**
 * Remote-task runtimes (`openclaw`, `hermes`) run on their own host, so a Channel seats them
 * without a device or working directory; the run routes to that host as an ordinary one does.
 */
const REMOTE_RUNTIMES = REMOTE_HETEROGENEOUS_AGENT_CONFIGS.map(({ type }) => type);

/**
 * Runtimes a Channel can seat: every runtime an Agent can have, derived rather than listed.
 * LobeHub's own `native` loop, every heterogeneous runtime that executes on its user's machine
 * and every remote-task runtime. A new runtime joins Channels when it joins the registry.
 */
export const CHANNEL_RUNTIMES = [
  'native',
  ...LocalExecutionHeterogeneousAgentTypeSchema.options,
  ...REMOTE_RUNTIMES,
] as const;
export type ChannelRuntime = (typeof CHANNEL_RUNTIMES)[number];

export const isChannelRuntime = (runtime: string): runtime is ChannelRuntime =>
  (CHANNEL_RUNTIMES as readonly string[]).includes(runtime);

/** A runtime that runs on its own host: a Channel picks no device or directory for it. */
export const isRemoteChannelRuntime = (runtime: string) =>
  (REMOTE_RUNTIMES as readonly string[]).includes(runtime);

/** The directory on that device: the Agent's own choice there, else the device's default. */
export const defaultChannelAgentDirectory = (
  agencyConfig: Pick<LobeAgentAgencyConfig, 'workingDirByDevice'> | null | undefined,
  deviceId: string,
  deviceDefaultCwd?: string | null,
): string | undefined =>
  getWorkingDirEffectivePath(agencyConfig?.workingDirByDevice?.[deviceId]) ||
  deviceDefaultCwd ||
  undefined;

export const CHANNEL_LIMITS = {
  /** Files attached to one message. */
  attachments: 20,
  /** Characters in one message. */
  contentLength: 100_000,
  /** Characters in a channel name. */
  titleLength: 100,
} as const;

/** Display name for a person whose account was deleted; their member row stays. */
export const CHANNEL_DELETED_USER_NAME = 'Deleted user';
export const CHANNEL_DELETED_AGENT_NAME = 'Deleted agent';

/** Discoverability inside a workspace. Ignored for personal channels (`workspace_id IS NULL`). */
export type ChannelVisibility = 'private' | 'public';

/**
 * Channel lifecycle. Orthogonal to the recycle bin: archiving keeps a channel for good, while
 * a trashed one is purged once its retention expires.
 * - `active`: listed and open to messages and Agent work.
 * - `archived`: finished but kept. Readable and searchable, out of the active list, closed to
 *   messages and Agent work until an admin unarchives it.
 */
export type ChannelStatus = 'active' | 'archived';

/**
 * Thread lifecycle, orthogonal to the recycle bin like `ChannelStatus`.
 * - `active`: open to replies and Agent work.
 * - `archived`: readable history, out of Agent context. It still holds its root message, so
 *   unarchiving brings the same Thread back.
 */
export type ChannelThreadStatus = 'active' | 'archived';

export type ChannelMemberActorType = 'agent' | 'user';

/** Role of a human member. Agent members carry no role. */
export type ChannelMemberRole = 'admin' | 'member' | 'owner';

/**
 * Membership state. A former member keeps its row, so jobs, mentions, Thread followers and
 * authored messages still resolve.
 * - `active`: in the channel.
 * - `left`: the person left on their own.
 * - `removed`: an admin removed the person or Agent.
 * Either former state can be added back.
 */
export type ChannelMemberStatus = 'active' | 'left' | 'removed';

/** Channel-specific execution environment; Agent settings always come from the Agent. */
export interface ChannelMemberConfig {
  deviceId?: string;
  /**
   * User whose device runs this member. Device calls route by this id, never by the channel
   * creator, so a workspace channel can use another member's device after its owner approves.
   */
  deviceOwnerId?: string;
  /**
   * The Agent stays quiet here: nothing reaches it unless a person @mentions it, and it cannot
   * post on its own. Kept beside the environment and reply strategy, never part of execution.
   */
  muted?: boolean;
  /**
   * This member's own reply strategy, over the channel's `ChannelConfig.wake`. Parsed by the
   * shared wake schema; never part of the execution environment.
   */
  wake?: Record<string, unknown>;
  /** Set only from a device's canonical-path acknowledgement before claiming work. */
  workingDirectory?: string;
}

/**
 * Channel-wide settings a member configures and the server validates, unlike `ChannelMetadata`.
 * Agent members can override them in `ChannelMemberConfig`; NULL means every default applies.
 */
export interface ChannelConfig {
  /** How Agents decide to answer unaddressed messages; parsed by the shared wake schema. */
  wake?: Record<string, unknown>;
}

/**
 * A git worktree a member's conversation branch moved into when another run held its
 * configured directory. Cut from that directory's HEAD; the branch keeps working there until
 * the member's environment changes.
 */
export interface ChannelMemberWorktree {
  branch: string;
  deviceId: string;
  /** Absolute path under `~/.lobehub/worktrees/`, see `deriveWorktreePath`. */
  path: string;
  /** The member's configured directory it was cut from. */
  sourceDirectory: string;
}

/** Free-form member state that does not need its own column. */
export type ChannelMemberMetadata = Record<string, unknown> & {
  /** The member who added this one; absent when they joined on their own or before it was kept. */
  invitedBy?: string;
  /** Worktree per conversation branch: a Thread id, or `main` for the main timeline. */
  worktrees?: Record<string, ChannelMemberWorktree>;
  /** The configured directory could not host a worktree (e.g. not a git repo); retried later. */
  worktreeUnavailable?: { at: string; deviceId: string; sourceDirectory: string };
};

/** Free-form channel state that does not need its own column. */
export type ChannelMetadata = Record<string, unknown>;

/** Free-form grant state that does not need its own column. */
export type ChannelMemberGrantMetadata = Record<string, unknown>;

/** Free-form Thread state that does not need its own column. */
export type ChannelThreadMetadata = Record<string, unknown>;

/** Free-form public message state that does not need its own column. */
export type ChannelMessageMetadata = Record<string, unknown>;

/**
 * The Agent that wrote a message on its requester's behalf (`lobe-channel.sendMessage` /
 * `messagePerson`). The person stays the sender and execution identity; this only says who
 * relayed it.
 */
export interface ChannelMessageVia {
  agentId: string;
  name: string;
}

/**
 * Where a relayed request came from (`metadata.via.origin`), kept server-side so the target's
 * reply can be delivered back there as a receipt.
 */
export interface ChannelRelayOrigin {
  channelId: string;
  threadId: string | null;
}

/**
 * `metadata.receipt` of a request that brings another Channel's reply back to the Agent that
 * relayed the original message. Its `via` names the Agent that answered.
 */
export interface ChannelMessageReceipt {
  /**
   * The Agent whose answer the message reports, on an Agent's report from a conversation between
   * Agents. Absent on a relay receipt, which names that Agent in `via`.
   */
  agent?: { agentId: string; name: string };
  channelId: string;
  channelTitle: string;
  /** The published reply in that Channel. */
  messageId: string;
}

export const channelRelayOrigin = (
  metadata: ChannelMessageMetadata | null | undefined,
): ChannelRelayOrigin | undefined => {
  const origin = (metadata?.via as { origin?: Partial<ChannelRelayOrigin> } | undefined)?.origin;
  return typeof origin?.channelId === 'string'
    ? { channelId: origin.channelId, threadId: origin.threadId ?? null }
    : undefined;
};

/**
 * `metadata.exchange` of a request one Agent wrote to another in their conversation: where the
 * asking began (what the asking Agent concludes is posted there), and how many asks the exchange
 * has taken, counting this one. A request it carries is never a relay, so it has no `via`.
 */
export interface ChannelAgentExchange {
  hops: number;
  origin: ChannelRelayOrigin;
}

export const channelAgentExchange = (
  metadata: ChannelMessageMetadata | null | undefined,
): ChannelAgentExchange | undefined => {
  const exchange = metadata?.exchange as
    { hops?: unknown; origin?: Partial<ChannelRelayOrigin> } | undefined;
  const { hops, origin } = exchange ?? {};
  if (typeof origin?.channelId !== 'string') return;
  return {
    hops: typeof hops === 'number' && Number.isSafeInteger(hops) && hops > 0 ? hops : 1,
    origin: { channelId: origin.channelId, threadId: origin.threadId ?? null },
  };
};

export const channelMessageReceipt = (
  metadata: ChannelMessageMetadata | null | undefined,
): ChannelMessageReceipt | undefined => {
  const receipt = metadata?.receipt as Partial<ChannelMessageReceipt> | undefined;
  return typeof receipt?.channelId === 'string' &&
    typeof receipt.channelTitle === 'string' &&
    typeof receipt.messageId === 'string'
    ? {
        ...(typeof receipt.agent?.agentId === 'string' &&
          typeof receipt.agent.name === 'string' && {
            agent: { agentId: receipt.agent.agentId, name: receipt.agent.name },
          }),
        channelId: receipt.channelId,
        channelTitle: receipt.channelTitle,
        messageId: receipt.messageId,
      }
    : undefined;
};

/** When the message was deleted (`metadata.deletedAt`); null while it stands. */
export const channelMessageDeletedAt = (
  metadata: ChannelMessageMetadata | null | undefined,
): Date | null => {
  const deletedAt = metadata?.deletedAt;
  return typeof deletedAt === 'string' ? new Date(deletedAt) : null;
};

/** When a person last edited their message (`metadata.editedAt`); null if never. */
export const channelMessageEditedAt = (
  metadata: ChannelMessageMetadata | null | undefined,
): Date | null => {
  const editedAt = metadata?.editedAt;
  return typeof editedAt === 'string' ? new Date(editedAt) : null;
};

/** `metadata.via` of a relayed request, or undefined for anything else. */
export const channelMessageVia = (
  metadata: ChannelMessageMetadata | null | undefined,
): ChannelMessageVia | undefined => {
  const via = metadata?.via as Partial<ChannelMessageVia> | undefined;
  return typeof via?.agentId === 'string' && typeof via.name === 'string'
    ? { agentId: via.agentId, name: via.name }
    : undefined;
};

/** Effective Agent settings and Channel environment, frozen once when a job is claimed. */
/**
 * Another person's Agent reached through the requester's contact entry and its link share. The
 * run executes as the Agent's owner under the share's limits; the topic is the owner's, tagged
 * with the requester as its sender.
 */
export interface ChannelSharedAgentAccess {
  ownerId: string;
  shareId: string;
  /** The Agent's scope, which the run and its topic use; not the Channel's. */
  workspaceId: string | null;
}

export interface ChannelExecutionConfig extends LobeAgentConfig, ChannelMemberConfig {
  provider: string;
  runtime: ChannelRuntime;
  /** Set when the Agent belongs to someone else and is used through its share. */
  share?: ChannelSharedAgentAccess;
  /** Set when the run works in its branch's worktree; `workingDirectory` is then that worktree. */
  worktreeBranch?: string;
}

/**
 * - `directed`: carried explicit @mentions; jobs were created in the send transaction.
 * - `pending`: waiting for the decision model to pick responders.
 * - `assigned`: the decision model (or the no-model fallback) picked at least one Agent.
 * - `unassigned`: routing could not complete; no Agent was woken and the user may retry.
 * - `skipped`: the decision model decided nobody needs to reply. Not a failure.
 * - `reply`: an Agent's published reply; replies never enter routing.
 */
export type ChannelMessageRoutingStatus =
  'assigned' | 'directed' | 'pending' | 'reply' | 'skipped' | 'unassigned';

/**
 * - `explicit`: recipients came from @mentions, Thread followers or a bound direct Agent.
 * - `decision`: recipients came from a `decide()` call.
 * - `fallback`: no decision model is configured, so every available Agent was picked.
 */
export type ChannelMessageRoutingSource = 'decision' | 'explicit' | 'fallback';

/**
 * How a human message without @mentions is routed: `decision` when a decision model is
 * configured, otherwise `fallback` to every candidate Agent.
 */
export type ChannelRoutingMode = 'decision' | 'fallback';

/**
 * - `queued`: waiting at the member's FIFO.
 * - `running`: claimed; its operation carries the execution status.
 * - `completed`: the final reply was published.
 * - `failed`: ended without a publishable reply, or its execution failed or became unknown.
 * - `cancelled`: stopped, or it can never run (requester left, environment switched).
 * - `silent`: a `followup` wake the Agent chose not to answer (`NO_REPLY`). Settled, not failed.
 */
export type ChannelJobStatus =
  'cancelled' | 'completed' | 'failed' | 'queued' | 'running' | 'silent';

/**
 * Why a job was woken, frozen when it is delivered.
 *
 * - `mention`: someone addressed the member (an @mention, a reply, the paired Agent of a direct
 *   conversation) or routing chose it; it owes an answer.
 * - `followup`: nobody addressed it; speaking is optional and it may end in `silent`.
 *
 * The details are what the woken Agent is told about the wake.
 */
export interface ChannelJobWake {
  /**
   * The member whose reply to the same message this wake waits for: the message's one primary
   * responder. The job starts only after that member's job settles, with its reply in the prompt,
   * so it can stay silent when the reply already covers the request.
   */
  afterMemberId?: string;
  /** The message falls within the member's duties (`helpful`: it can settle an open question). */
  duty?: { helpful?: boolean; matched?: string };
  /** The member spoke here lately and this message followed. */
  followup?: {
    participants: { isBot: boolean; isOwner: boolean; name: string }[];
    score?: number;
  };
  kind: BotWakeKind;
  /** The message says the member's name without @-mentioning it. */
  named?: boolean;
  /** The rule that woke it, as the decision row records it. */
  reason?: string;
}

/** Why a queued job cannot start yet. Typed so clients never infer it from error text. */
export type ChannelJobBlockCode =
  /** A deferred `followup` waiting for the message's primary responder to settle. */
  | 'awaiting_primary'
  | 'device_approval_pending'
  | 'device_offline'
  | 'device_required'
  | 'directory_locked'
  | 'member_busy'
  | 'unavailable'
  | 'workspace_changed';

/** Approval of a member that executes on someone's personal device (or a private shared one). */
export type ChannelMemberGrantStatus = 'approved' | 'pending' | 'rejected' | 'revoked';

export type ChannelMemberGrantRevokeReason = 'device_owner_left' | 'revoked_by_owner';

export interface ChannelContextMessage {
  /** `id` is the actual user/Agent id, or NULL after author deletion. */
  author: { id: string | null; name: string; type: ChannelMemberActorType };
  content: string;
  /** Stable references; URLs and document contents are resolved at execution time. */
  fileIds?: string[];
  id: string;
  /** Set on a request that brings another Channel's reply back to the relaying Agent. */
  receipt?: ChannelMessageReceipt;
  replyToId?: string | null;
  sequence: number;
  threadId: string | null;
  /** Set on a request an Agent relayed for its author. */
  via?: ChannelMessageVia;
}

/** Read-only history of the current Channel operation; scope is never supplied by the model. */
export interface ChannelReadMessagesParams {
  /** Exclusive sequence cursor returned by the preceding page. */
  beforeSequence?: number;
  limit?: number;
  /**
   * Another Thread of the current Channel (from `listThreads`), read live up to its latest
   * message instead of the run's request cutoff. Omit for the run's own conversation.
   */
  threadId?: string;
}

export interface ChannelReadMessageParams {
  messageId: string;
  /** Character offset for reading a long message without flooding the context. */
  offset?: number;
  /** The Thread `readMessages({ threadId })` returned the message from. */
  threadId?: string;
}

export interface ChannelHistoryMessage extends ChannelContextMessage {
  contentLength: number;
  truncated: boolean;
}

export interface ChannelHistoryPage {
  cutoffSequence: number;
  messages: ChannelHistoryMessage[];
  nextBeforeSequence: number | null;
}

/** Channels the run's requester belongs to, to find where to reach another Agent. */
export interface ChannelListChannelsParams {
  /** Only Channels where this Agent is an active member. */
  agentId?: string;
  limit?: number;
  /** Case-insensitive match on the Channel title or an Agent member's name. */
  query?: string;
}

export interface ChannelDirectoryEntry {
  agents: Array<{ agentId: string; description: string | null; name: string }>;
  /** The Channel this run answers in. */
  current: boolean;
  id: string;
  /**
   * `direct`: one person and its bound Agent; `agents`: where two of the person's Agents ask each
   * other; `group`: everything else.
   */
  kind: 'agents' | 'direct' | 'group';
  projectId: string | null;
  title: string;
}

export interface ChannelDirectoryPage {
  channels: ChannelDirectoryEntry[];
  /** More Channels matched than were returned; narrow with `query` or `agentId`. */
  hasMore: boolean;
}

/** A request posted into another Channel for the run's requester, @mentioning its Agents. */
export interface ChannelSendMessageParams {
  /**
   * Agents to address. One Agent is asked in the conversation between the two Agents; several are
   * addressed in `channelId`, a group Channel they are all active members of.
   */
  agentIds: string[];
  /** Required for several Agents; for one, only a hint of where the person reaches it. */
  channelId?: string;
  content: string;
}

export interface ChannelSentMessage {
  agents: Array<{ agentId: string; name: string }>;
  channelId: string;
  channelTitle: string;
  messageId: string;
  /** Link to the Channel the message was posted in, for the reply that mentions it. */
  url: string;
}

/** People the run's requester can message one-on-one in the run's scope. */
export interface ChannelListPeopleParams {
  limit?: number;
  /** Case-insensitive part of the person's display name or @handle. */
  query?: string;
}

export interface ChannelPerson {
  name: string;
  userId: string;
  username: string | null;
}

export interface ChannelPeoplePage {
  /** More people matched than were returned; narrow with `query`. */
  hasMore: boolean;
  people: ChannelPerson[];
}

/** A message for one person, posted in the requester's conversation with them. */
export interface ChannelMessagePersonParams {
  content: string;
  userId: string;
}

export interface ChannelSentPersonMessage {
  channelId: string;
  messageId: string;
  person: ChannelPerson;
  /** Link to the requester's conversation with the person. */
  url: string;
}

/** Threads of the current Channel, to see what runs in them and act on one. */
export interface ChannelListThreadsParams {
  /** Only Threads where you (the calling Agent) have a queued or running reply. */
  activeOnly?: boolean;
  /** Exclusive cursor: the threadId a previous page ended on (`nextBefore`). */
  before?: string;
  limit?: number;
}

/** One step of a running reply, read from its conversation: what it is doing right now. */
export interface ChannelThreadRunActivity {
  at: string;
  role: string;
  /** Text excerpt of the step. */
  text?: string;
  /** Tool calls of the step, as `identifier.apiName`. */
  tools?: string[];
}

/** A reply of the calling Agent in a Thread. */
export interface ChannelThreadRun {
  /** Latest steps of a running reply you can see (your requester's own run); newest last. */
  activity?: ChannelThreadRunActivity[];
  createdAt: string;
  /** The request it answers, excerpted. */
  request: string;
  /** Who asked for it. */
  requester: string;
  /** `queued` / `running` still go on; the rest have ended. */
  status: ChannelJobStatus;
  /** Steps taken so far, when known. */
  stepCount?: number | null;
}

export interface ChannelThreadSummary {
  /** The Thread this run answers in. */
  current: boolean;
  /** Latest message in the Thread, excerpted. */
  lastMessage: { author: string; content: string } | null;
  messageCount: number;
  /** The root message on the main timeline, excerpted: what the Thread is about. */
  root: string;
  /** Your latest reply in this Thread, if any. */
  run: ChannelThreadRun | null;
  status: ChannelThreadStatus;
  threadId: string;
}

export interface ChannelThreadPage {
  hasMore: boolean;
  /** Cursor for the next older page: the last threadId here. `null` when this is the last page. */
  nextBefore: string | null;
  threads: ChannelThreadSummary[];
}

/** Opens a new Thread in the current Channel and gives an Agent its first request there. */
export interface ChannelCreateThreadParams {
  /** Agent to answer in the Thread; defaults to you. Must be an Agent member of this Channel. */
  agentId?: string;
  /** The request, self-contained: the Thread's run sees the Thread, not your conversation. */
  content: string;
  /** Short title, posted as the Thread's root on the main timeline. */
  title: string;
}

export interface ChannelCreatedThread {
  agent: { agentId: string; name: string };
  messageId: string;
  threadId: string;
  title: string;
}

export interface ChannelStopThreadParams {
  reason?: string;
  threadId: string;
}

export interface ChannelStoppedThread {
  /** Replies that were queued or running and are now stopped. */
  stopped: number;
  threadId: string;
}

/** A correction for your reply in another Thread of the current Channel. */
export interface ChannelSteerThreadParams {
  content: string;
  threadId: string;
}

export interface ChannelSteeredThread {
  /**
   * `steered`: the running reply reads it at its next step. `queued`: nothing was running (or it
   * could not be reached), so it was posted in the Thread as a new request for you.
   */
  delivery: 'queued' | 'steered';
  messageId?: string;
  threadId: string;
}

/** Periodic progress reports on Threads, posted to the main timeline as requests for you. */
export interface ChannelWatchThreadsParams {
  /** Minutes between reports, 1–120. */
  intervalMinutes: number;
  /** Reports at most this many times (default 12, max 48); stops earlier when all are done. */
  maxReports?: number;
  /**
   * What each report should cover, in your requester's language. It is posted on the main
   * timeline as their request to you, followed by the watched Threads.
   */
  prompt?: string;
  threadIds: string[];
}

export interface ChannelWatchedThreads {
  intervalMinutes: number;
  maxReports: number;
  threadIds: string[];
  watchId: string;
}

export interface ChannelUnwatchThreadsParams {
  watchId: string;
}

export interface ChannelHistoryMessageDetail {
  attachments?: Array<{ fileType: string; id: string; name: string; size: number; url: string }>;
  message: ChannelHistoryMessage;
  nextOffset: number | null;
  offset: number;
}

/**
 * Frozen conversation scope. Only requestMessageId is delivered eagerly; history tools may
 * read the entire branch up to cutoffSequence.
 */
export interface ChannelInputManifest {
  /** Immutable at claim time; later public messages belong to the next run. */
  cutoffSequence: number;
  /**
   * A deferred `followup` (see `ChannelJobWake.afterMemberId`): the reply the primary responder
   * published to the same request, delivered with the request even though it is past the cutoff.
   */
  primaryReplyMessageId?: string;
  /** The member that triggered this run; its user is the execution identity. */
  requesterMemberId: string;
  requestMessageId: string;
  /** Fixed at claim time. */
  self: { agentId: string; memberId: string; name: string };
  threadId: string | null;
  /** Main-channel prefix visible to this branch; null for main. */
  threadRootSequence: number | null;
}

/** Flat audit payload: routing decisions, claims, stops, isolation reasons. */
export type ChannelAuditDetails = Record<string, boolean | number | string | string[] | null>;

/** A public group Channel the caller has not joined yet, as the browse list shows it. */
export interface ChannelJoinableItem {
  createdAt: Date;
  id: string;
  /** Active people in it, Agents not counted. */
  memberCount: number;
  projectId: string | null;
  title: string;
}

/** A member pictured in a Channel's list avatar. */
export interface ChannelAvatarMember {
  actorType: ChannelMemberActorType;
  avatar: string | null;
  backgroundColor: string | null;
  /** The Agent id or user id; seeds a generated avatar when there is no image. */
  id: string;
  name: string | null;
}

/** A Channel's newest message as its list row previews it. */
export interface ChannelLastMessage {
  /**
   * The first attachment's MIME type and how many there are, so a message of only an image
   * still has a preview line; null without attachments.
   */
  attachments: { count: number; fileType: string } | null;
  /** Who sent it, so a list can read "Me: …" or "Alice: …"; `id` is null after deletion. */
  author: { id: string | null; name: string | null; type: ChannelMemberActorType };
  /** A shared contact card, so a list can localize "[Contact card] …" instead of the stored text. */
  card?: { name: string | null; type: ContactCardType } | null;
  content: string;
  createdAt: Date;
  /**
   * The Thread it was posted in, named by its title or else the first line of its root message;
   * null for the main conversation.
   */
  thread: { id: string; title: string | null } | null;
}

/** The newest message in a Thread that @mentions the caller. */
export interface ChannelThreadMention {
  createdAt: Date;
  threadId: string;
}

/** Public client projection. No execution configuration, private topic or draft fields. */
export interface ChannelListItem {
  /** The bound Agent of a direct conversation; null for a group. */
  agentId: string | null;
  /**
   * Every active Agent member, oldest first, so a page about one Agent can list the Channels it
   * takes part in; set by the Channel list.
   */
  agentIds?: string[];
  /** Server-computed for the current member. */
  canDelete: boolean;
  createdAt: Date;
  /**
   * The caller hid the conversation from their list; new activity brings it back. Set by the
   * Channel list. Personal: other members never see it.
   */
  hidden?: boolean;
  id: string;
  /**
   * False for a project Channel the caller can read through the project but has not joined; it
   * belongs in that project's list only. Absent means joined.
   */
  joined?: boolean;
  /** The newest message, Threads included, cut for a preview; set by the Channel list. */
  lastMessage?: ChannelLastMessage | null;
  /**
   * The first members besides the caller, oldest first, for a group Channel's list avatar;
   * set by the Channel list.
   */
  memberAvatars?: ChannelAvatarMember[];
  /**
   * The caller's own role here; null for an open project Channel they have not joined. Set by the
   * Channel list. Everyone but the owner may leave a group Channel.
   */
  memberRole?: ChannelMemberRole | null;
  /** Unread messages, Threads included, that @mention the caller; set by the Channel list. */
  mentionCount?: number;
  /**
   * On a conversation between two people, the other person (relative to the viewer), who is also
   * the only entry of `memberAvatars`; null otherwise.
   */
  peerUserId?: string | null;
  /**
   * When the caller pinned the conversation atop their own list, null when not pinned; set by the
   * Channel list. Personal: other members never see it.
   */
  pinnedAt?: Date | null;
  /** The project the channel is grouped under; null for a standalone channel. */
  projectId: string | null;
  /**
   * Main-conversation replies still pending (queued, running, or stopping), so a list row can
   * show them without loading the conversation; set by the Channel list.
   */
  replyJobs?: ChannelReplyJob[];
  /**
   * The caller's own sidebar section holding the conversation; null keeps it in the built-in one.
   * Set by the Channel list. Personal: other members never see it.
   */
  sectionId?: string | null;
  sequence: number;
  /**
   * A direct conversation with another person's Agent, reached through the caller's contact entry
   * and its share; pictured by `memberAvatars`, since the caller has no sidebar row for it.
   */
  sharedAgent?: boolean;
  /**
   * On a `sharedAgent` conversation, the share's custom slug or else its id: the Agent's visitor
   * page lives at `/a/<handle>`, the only page of it the caller can open. Null otherwise.
   */
  sharedAgentHandle?: string | null;
  status: ChannelStatus;
  /**
   * The newest @mention of the caller in each Thread from the last 30 days, read or not; set by
   * the Channel list. The read position cannot tell whether one was seen, so the client's
   * per-Thread reads decide.
   */
  threadMentions?: ChannelThreadMention[];
  title: string;
  /** Main-channel messages the caller has not read; set by the Channel list. */
  unreadCount?: number;
  /** Bumped by every new message, so it orders conversations by latest activity. */
  updatedAt?: Date;
  /** Ignored for a direct conversation, which is always private. */
  visibility: ChannelVisibility;
  workspaceId: string | null;
}

/** Where an Agent member runs in this Channel, readable by every member. */
export interface ChannelMemberEnvironmentPreview {
  deviceId: string | null;
  /** The device's friendly name, else its hostname; null when the device row is gone. */
  deviceName: string | null;
  workingDirectory: string | null;
}

export interface ChannelPublicMember {
  actorType: ChannelMemberActorType;
  agentId: string | null;
  avatar: string | null;
  description: string | null;
  /** Agent members only; null when the Channel sets no device or directory for it. */
  environment?: ChannelMemberEnvironmentPreview | null;
  id: string;
  /** The member who added this one; null when they joined on their own or the adder is unknown. */
  invitedBy: string | null;
  joinedAt: Date;
  /** An Agent that answers only when @mentioned; see `ChannelMemberConfig.muted`. */
  muted?: boolean;
  name: string | null;
  role: ChannelMemberRole | null;
  status: ChannelMemberStatus;
  userAvatar: string | null;
  userId: string | null;
  userName: string | null;
  username: string | null;
}

export interface ChannelPublicMessage {
  agentId: string | null;
  author: {
    avatar: string | null;
    id: string | null;
    name: string | null;
    type: ChannelMemberActorType;
  };
  /** A person or an Agent shared as a contact card; the content holds its text fallback. */
  card?: ContactCard | null;
  content: string;
  createdAt: Date;
  /**
   * Set once the message was deleted. Its row stays as a tombstone, without text, mentions or
   * attachments, so Threads, replies and jobs that point at it still resolve.
   */
  deletedAt?: Date | null;
  /** Set once the author has edited the text; shown as "(edited)". */
  editedAt?: Date | null;
  fileIds: string[];
  id: string;
  mentions: string[];
  /** Another Channel's reply this request brings back to the relaying Agent; null otherwise. */
  receipt?: ChannelMessageReceipt | null;
  recipientMemberIds: string[];
  /** Bounded public quote, including when its original is outside the loaded page. */
  replyTo?: Pick<
    ChannelPublicMessage,
    'id' | 'author' | 'content' | 'deletedAt' | 'sequence' | 'threadId'
  > | null;
  replyToId: string | null;
  routingStatus: ChannelMessageRoutingStatus;
  sequence: number;
  /** The Agent topic behind a reply, only when the viewer ran it (owns that topic). */
  sourceTopicId?: string | null;
  sourceTopicTitle?: string | null;
  threadId: string | null;
  userId: string | null;
  /** The Agent that relayed this request (or answered it, on a receipt); null otherwise. */
  via?: (ChannelMessageVia & { avatar: string | null }) | null;
  /**
   * External Works a reply's run touched: the conversation's work summaries, for every member,
   * without the ids that link them to the requester's Work, topic and run. Empty on requests.
   */
  works?: ExternalWorkSummaryItem[];
}

export interface ChannelPublicJob {
  blockedCode: ChannelJobBlockCode | null;
  /** Server-computed for the current member: its requester or an admin. */
  canStop: boolean;
  /**
   * The device the reply runs on, waits for or failed to reach, when known: the claimed
   * device, a failed dispatch's route, or the Agent's own bound device.
   */
  deviceId?: string | null;
  /** Failure diagnostic only. */
  errorMessage: string | null;
  /** Category of a failure (a `ChatErrorType`), for a localized explanation. */
  errorType?: string | null;
  id: string;
  memberId: string;
  messageId: string;
  /** The acknowledgement the reply posted before its run, so its outcome can show under it. */
  openingMessageId?: string | null;
  publicationRevoked: boolean;
  status: ChannelJobStatus;
  threadId: string | null;
  /**
   * The Agent topic the reply runs in, present only for the viewer who owns it (as
   * `sourceTopicId` on replies), so they can follow a reply still at work.
   */
  topicId?: string;
  /** Git branch of the worktree the run works in, instead of the member's own directory. */
  worktreeBranch?: string | null;
  writerHeld: boolean;
}

/** A pending reply in the fields its status is derived from. */
export type ChannelReplyJob = Pick<
  ChannelPublicJob,
  'blockedCode' | 'id' | 'memberId' | 'publicationRevoked' | 'status' | 'threadId' | 'writerHeld'
>;

export interface ChannelPublicThread {
  followerMemberIds: string[];
  id: string;
  /**
   * When the newest reply worth reporting as unread was posted: an Agent's acknowledgement before
   * its run is not, so it does not mark the thread unread while its preview still shows. Null when
   * the thread holds only acknowledgements; present under the same conditions as `lastReply`.
   */
  lastNewsAt?: Date | null;
  /**
   * The newest reply, for threads whose root is on the loaded main-timeline page. Absent in
   * thread views and in views cached before summaries existed.
   */
  lastReply?: Pick<ChannelPublicMessage, 'author' | 'content' | 'createdAt' | 'id'> | null;
  /** Replies in the thread, under the same conditions as `lastReply`. */
  replyCount?: number;
  rootMessageId: string;
  rootSequence: number;
  status: ChannelThreadStatus;
  /** Name an Agent gave the Thread when it moved its reply there; otherwise the root names it. */
  title?: string;
}

export interface ChannelDetail {
  attachments: Array<{ fileType: string; id: string; name: string; size: number; url: string }>;
  channel: ChannelListItem;
  hasMore: boolean;
  /**
   * The view's jobs. A main-timeline view also carries its threads' jobs still at work (queued,
   * running, or holding the writer); filter by `threadId` for one conversation's own.
   */
  jobs: ChannelPublicJob[];
  /** False while the caller reads an open project Channel without being a member; sending joins. */
  joined?: boolean;
  members: ChannelPublicMember[];
  messages: ChannelPublicMessage[];
  /**
   * True while a shared Agent's owner reads a visitor's conversation with it: the same view, with
   * no composer and no message actions.
   */
  readOnly?: boolean;
  rootMessage: ChannelPublicMessage | null;
  threads: ChannelPublicThread[];
}

/**
 * A visitor's direct conversation with a shared Agent, as its owner lists them when the share
 * lets the owner read visitor conversations.
 */
export interface ShareVisitorConversation {
  createdAt: Date;
  /** The visitor's Channel. */
  id: string;
  lastMessage: ChannelLastMessage | null;
  /** USD cost of every run in the conversation, from its run topics. */
  totalCost: number;
  totalTokens: number;
  updatedAt: Date;
  visitor: { avatar: string | null; id: string; name: string | null };
}
