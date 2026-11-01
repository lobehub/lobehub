import { type AgentGroupMembershipRef } from './types';

export const AGENT_OWNED_BY_GROUP = 'AGENT_OWNED_BY_GROUP';

/**
 * Ownership handover rejected: the agent's owner changed (or the agent left
 * the workspace) between the transfer request and its acceptance.
 */
export const AGENT_OWNERSHIP_STALE = 'AGENT_OWNERSHIP_STALE';

/**
 * A share binds its grants, billing scope and visitor history to the current
 * agent owner and workspace. Transfers remain unsupported while any share row
 * exists, including paused shares; disabling a link must not bypass the guard.
 */
export const AGENT_SHARED_TRANSFER_BLOCKED = 'AGENT_SHARED_TRANSFER_BLOCKED';

/**
 * Refusal to move an agent that belongs to a chat group rather than to the
 * user. Carries the groups so the caller can say WHICH ones, the way the
 * existing visibility guards do — "cannot move this agent" with no reason is
 * a dead end for the person looking at it.
 */
export class AgentOwnedByGroupError extends Error {
  constructor(readonly groups: AgentGroupMembershipRef[]) {
    super(AGENT_OWNED_BY_GROUP);
    this.name = 'AgentOwnedByGroupError';
  }
}
