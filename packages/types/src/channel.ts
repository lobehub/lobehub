import type { LobeAgentAgencyConfig, LobeAgentConfig, RemoteHeterogeneousAgentType } from './agent';
import { LocalExecutionHeterogeneousAgentTypeSchema } from './agent/heterogeneousAgent';
import { getWorkingDirEffectivePath } from './device';
import type { BotWakeKind } from './signal';

/**
 * Channel: a shared conversation where people and Agents talk together.
 *
 * Public content lives in channel_messages. Channel jobs trigger ordinary Agent topics
 * and operations; the internal transcript stays separate from the public timeline.
 */

/**
 * Runtimes a Channel can seat, derived rather than listed: LobeHub's own `native` loop plus every
 * heterogeneous runtime that executes on its user's machine (descriptor-backed CLIs and
 * protocol-driven local runtimes). A new local runtime joins Channels when it joins the provider
 * registry; only runtimes known not to work are excluded below, each with its reason.
 */
const LOCAL_EXECUTION_RUNTIMES = LocalExecutionHeterogeneousAgentTypeSchema.options;

/**
 * Remote-task runtimes (`openclaw`, `hermes`) run a task on a remote host instead of on a seated
 * device, so a Channel's "pick a device + working directory" premise does not hold for them.
 * They are not part of LOCAL_EXECUTION_RUNTIMES; this list documents the exclusion and is
 * asserted by tests so a remote runtime cannot slip in by being reclassified.
 */
export const CHANNEL_EXCLUDED_RUNTIMES: Readonly<Record<RemoteHeterogeneousAgentType, string>> = {
  hermes:
    'remote-task runtime: runs off-device, so there is no Channel device or working directory',
  openclaw:
    'remote-task runtime: runs off-device, so there is no Channel device or working directory',
};

export const CHANNEL_RUNTIMES = ['native', ...LOCAL_EXECUTION_RUNTIMES] as const;
export type ChannelRuntime = 'native' | (typeof LOCAL_EXECUTION_RUNTIMES)[number];

export const isChannelRuntime = (runtime: string): runtime is ChannelRuntime =>
  !Object.hasOwn(CHANNEL_EXCLUDED_RUNTIMES, runtime) &&
  (CHANNEL_RUNTIMES as readonly string[]).includes(runtime);

/**
 * The device a Channel seats an Agent on until someone picks another: the one the Agent is bound
 * to, else this person's own desktop for an Agent that runs on its user's machine (`local`, or an
 * external runtime with no target). Never another available or online device.
 */
export const defaultChannelAgentDevice = ({
  agencyConfig,
  localDeviceId,
  runtime,
  workspaceScoped,
}: {
  agencyConfig?: Pick<LobeAgentAgencyConfig, 'boundDeviceId' | 'executionTarget'> | null;
  /** This person's own desktop, when they act from one. */
  localDeviceId?: string;
  runtime: string;
  /** The Agent runs on workspace devices only, never a personal desktop. */
  workspaceScoped?: boolean;
}): string | undefined => {
  const target = agencyConfig?.executionTarget;
  if (target === 'none' || target === 'sandbox' || target === 'auto') return;
  const localDefault =
    !workspaceScoped && (target === 'local' || (target === undefined && runtime !== 'native'));
  return agencyConfig?.boundDeviceId || (localDefault ? localDeviceId : undefined);
};

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

/** Effective Agent settings and Channel environment, frozen once when a job is claimed. */
export interface ChannelExecutionConfig extends LobeAgentConfig, ChannelMemberConfig {
  provider: string;
  runtime: ChannelRuntime;
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
  replyToId?: string | null;
  sequence: number;
  threadId: string | null;
}

/** Read-only history of the current Channel operation; scope is never supplied by the model. */
export interface ChannelReadMessagesParams {
  /** Exclusive sequence cursor returned by the preceding page. */
  beforeSequence?: number;
  limit?: number;
}

export interface ChannelReadMessageParams {
  messageId: string;
  /** Character offset for reading a long message without flooding the context. */
  offset?: number;
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

/** Public client projection. No execution configuration, private topic or draft fields. */
export interface ChannelListItem {
  /** The bound Agent of a direct conversation; null for a group. */
  agentId: string | null;
  /** Server-computed for the current member. */
  canDelete: boolean;
  createdAt: Date;
  id: string;
  /** The newest main-channel message, cut for a preview; set by the Channel list. */
  lastMessage?: { content: string; createdAt: Date } | null;
  /** Unread messages, Threads included, that @mention the caller; set by the Channel list. */
  mentionCount?: number;
  /** The project the channel is grouped under; null for a standalone channel. */
  projectId: string | null;
  /**
   * Main-conversation replies still pending (queued, running, or stopping), so a list row can
   * show them without loading the conversation; set by the Channel list.
   */
  replyJobs?: ChannelReplyJob[];
  sequence: number;
  status: ChannelStatus;
  title: string;
  /** Main-channel messages the caller has not read; set by the Channel list. */
  unreadCount?: number;
  /** Bumped by every new message, so it orders conversations by latest activity. */
  updatedAt?: Date;
  workspaceId: string | null;
}

export interface ChannelPublicMember {
  actorType: ChannelMemberActorType;
  agentId: string | null;
  avatar: string | null;
  description: string | null;
  id: string;
  joinedAt: Date;
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
  content: string;
  createdAt: Date;
  fileIds: string[];
  id: string;
  mentions: string[];
  recipientMemberIds: string[];
  /** Bounded public quote, including when its original is outside the loaded page. */
  replyTo?: Pick<
    ChannelPublicMessage,
    'id' | 'author' | 'content' | 'sequence' | 'threadId'
  > | null;
  replyToId: string | null;
  routingStatus: ChannelMessageRoutingStatus;
  sequence: number;
  /** The Agent topic behind a reply, only when the viewer ran it (owns that topic). */
  sourceTopicId?: string | null;
  sourceTopicTitle?: string | null;
  threadId: string | null;
  userId: string | null;
}

export interface ChannelPublicJob {
  blockedCode: ChannelJobBlockCode | null;
  /** Server-computed for the current member: its requester or an admin. */
  canStop: boolean;
  /** Failure diagnostic only. */
  errorMessage: string | null;
  id: string;
  memberId: string;
  messageId: string;
  publicationRevoked: boolean;
  status: ChannelJobStatus;
  threadId: string | null;
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
  rootMessageId: string;
  rootSequence: number;
  status: ChannelThreadStatus;
}

export interface ChannelDetail {
  attachments: Array<{ fileType: string; id: string; name: string; size: number; url: string }>;
  channel: ChannelListItem;
  hasMore: boolean;
  jobs: ChannelPublicJob[];
  members: ChannelPublicMember[];
  messages: ChannelPublicMessage[];
  rootMessage: ChannelPublicMessage | null;
  threads: ChannelPublicThread[];
}
