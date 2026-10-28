import type { LobeAgentConfig } from './agent';

/**
 * Channel: a shared conversation where people and Agents talk together.
 *
 * Public content lives in channel_messages. Channel jobs trigger ordinary Agent topics
 * and operations; the internal transcript stays separate from the public timeline.
 */

export const CHANNEL_RUNTIMES = [
  'native',
  'codex',
  'amp',
  'grok-build',
  'claude-code',
  'pi',
] as const;
export type ChannelRuntime = (typeof CHANNEL_RUNTIMES)[number];

export const isChannelRuntime = (runtime: string): runtime is ChannelRuntime =>
  (CHANNEL_RUNTIMES as readonly string[]).includes(runtime);

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
  /** Set only from a device's canonical-path acknowledgement before claiming work. */
  workingDirectory?: string;
}

/** Free-form member state that does not need its own column. */
export type ChannelMemberMetadata = Record<string, unknown>;

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
}

/**
 * - `directed`: carried explicit @mentions; jobs were created in the send transaction.
 * - `pending`: waiting for Jev to pick responders.
 * - `assigned`: Jev (or the no-model fallback) picked at least one Agent.
 * - `unassigned`: routing could not complete; no Agent was woken and the user may retry.
 * - `skipped`: Jev decided nobody needs to reply. Not a failure.
 * - `reply`: an Agent's published reply; replies never enter routing.
 */
export type ChannelMessageRoutingStatus =
  'assigned' | 'directed' | 'pending' | 'reply' | 'skipped' | 'unassigned';

/**
 * - `explicit`: recipients came from @mentions, Thread followers or a bound direct Agent.
 * - `jev`: recipients came from a `decide()` call.
 * - `fallback`: no decision model is configured, so every available Agent was picked.
 */
export type ChannelMessageRoutingSource = 'explicit' | 'fallback' | 'jev';

/**
 * How a human message without @mentions is routed: `jev` when a decision model is
 * configured, otherwise `fallback` to every candidate Agent.
 */
export type ChannelRoutingMode = 'fallback' | 'jev';

/**
 * - `queued`: waiting at the member's FIFO.
 * - `running`: claimed; its operation carries the execution status.
 * - `completed`: the final reply was published.
 * - `failed`: ended without a publishable reply, or its execution failed or became unknown.
 * - `cancelled`: stopped, or it can never run (requester left, environment switched).
 */
export type ChannelJobStatus = 'cancelled' | 'completed' | 'failed' | 'queued' | 'running';

/** Why a queued job cannot start yet. Typed so clients never infer it from error text. */
export type ChannelJobBlockCode =
  | 'device_approval_pending'
  | 'device_offline'
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
  /** Server-computed for the current member. */
  canDelete: boolean;
  createdAt: Date;
  id: string;
  /** The project the channel is grouped under; null for a standalone channel. */
  projectId: string | null;
  sequence: number;
  status: ChannelStatus;
  title: string;
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
  replyToId: string | null;
  routingStatus: ChannelMessageRoutingStatus;
  sequence: number;
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
  writerHeld: boolean;
}

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
