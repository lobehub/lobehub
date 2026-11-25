import type { ChannelAgentGrantStatus, ChannelMessageMetadata } from './channel';

/**
 * Whether a person may use an Agent, as `resolveAgentAccess` answers it before they send:
 *
 * - `ok`: they can use it, as their own or through a share that admits them.
 * - `needs_grant`: its owner has not granted them what is `missing`; they can ask.
 * - `grant_pending`: they asked, and its owner has not decided yet.
 * - `denied`: its owner declined their latest request; they may ask again.
 * - `unavailable`: nobody can grant it (the Agent is gone, or its runtime never runs for others).
 */
export type AgentAccessState = 'denied' | 'grant_pending' | 'needs_grant' | 'ok' | 'unavailable';

/**
 * What a person lacks to use another person's Agent:
 *
 * - `share`: its share does not admit them (none, paused, or a card share they were not given).
 * - `device`: it runs a local CLI (Claude Code, Codex, …) on its owner's device, and the share does
 *   not grant them that device.
 * - `channel`: in a group, its owner has not allowed them to use it in this Channel.
 */
export type AgentAccessMissing = 'channel' | 'device' | 'share';

/** A person's latest request to use an Agent, as its requester sees it. */
export interface AgentAccessRequestSummary {
  /** The Channel the request was made in; its card sits in the owner's conversation with the Agent. */
  channelId: string;
  createdAt: Date;
  decidedAt: Date | null;
  /** `channel_agent_grants.id`; approve or deny it with `decideAgentAccess`. */
  id: string;
  status: ChannelAgentGrantStatus;
}

/** The answer of `resolveAgentAccess`, for the client entering an Agent's conversation or profile. */
export interface AgentAccessResult {
  /** Empty unless `state` is `needs_grant`, `grant_pending` or `denied`. */
  missing: AgentAccessMissing[];
  /** The Agent's owner, who decides requests; null when the Agent is gone. */
  ownerId: string | null;
  /** The requester's latest request, in the Channel asked about or (without one) anywhere. */
  request: AgentAccessRequestSummary | null;
  state: AgentAccessState;
  /** How an `ok` person uses it: as their own (or their workspace's), or through its share. */
  via: 'own' | 'share' | null;
}

/** The owner's decision on a request; both are idempotent. */
export type AgentAccessDecision = 'approve' | 'deny';

/**
 * `metadata.agentAccess` of the card an Agent posts in its owner's direct conversation with it
 * when someone asks to use it. Only `grantId` is authoritative; the rest is the server's snapshot
 * at request time, so the card reads without the Channel. Only the owner reads the card: it lives
 * in their own conversation, and the view hydrates its status for them alone.
 */
export interface ChannelAgentAccessRequest {
  agentId: string;
  agentName: string | null;
  /** Where the request was made: a group, or the requester's own conversation with the Agent. */
  channelId: string;
  channelTitle: string;
  grantId: string;
  /** What approving grants; see {@link AgentAccessMissing}. */
  missing: AgentAccessMissing[];
  requesterName: string | null;
  requesterUserId: string | null;
}

/** A request card as its owner reads it: `expired` once the request was replaced or removed. */
export type ChannelAgentAccessCard = ChannelAgentAccessRequest & {
  status: ChannelAgentGrantStatus | 'expired';
};

const MISSING = new Set<AgentAccessMissing>(['channel', 'device', 'share']);

/** `metadata.agentAccess` of an access request card, or undefined for anything else. */
export const channelMessageAgentAccess = (
  metadata: ChannelMessageMetadata | null | undefined,
): ChannelAgentAccessRequest | undefined => {
  const request = metadata?.agentAccess as Partial<ChannelAgentAccessRequest> | undefined;
  return typeof request?.grantId === 'string' &&
    typeof request.agentId === 'string' &&
    typeof request.channelId === 'string'
    ? {
        agentId: request.agentId,
        agentName: request.agentName ?? null,
        channelId: request.channelId,
        channelTitle: request.channelTitle ?? '',
        grantId: request.grantId,
        missing: Array.isArray(request.missing)
          ? request.missing.filter((item): item is AgentAccessMissing => MISSING.has(item))
          : [],
        requesterName: request.requesterName ?? null,
        requesterUserId: request.requesterUserId ?? null,
      }
    : undefined;
};

/**
 * The stored text of an access request card, for every reader that does not render the card:
 * list previews, notifications and the Agent itself. Clients that render cards localize their own.
 */
export const agentAccessRequestText = (request: ChannelAgentAccessRequest) =>
  `[Access request] ${request.requesterName || 'Someone'} wants to use ${
    request.agentName || 'this Agent'
  }${request.channelTitle ? ` in "${request.channelTitle}"` : ''}. Allow?`;
