/**
 * A change to what an Agent share lets other people do: who it admits, what they may reach, and
 * what its creator may see. A share mutation describes each change it makes as before/after
 * snapshots of the authorization one kind covers, and hands them to the optional
 * {@link AgentShareAuthorizationObserver}.
 */
export type AgentShareAuthorizationKind =
  /** Tools, skills, automatic Agent-tool grants and memory reads opened to share visitors. */
  | 'agent_share.capabilities'
  /** Which visitors may run on the Agent's device (`deviceAccess` + its allowlist). */
  | 'agent_share.device_access'
  /** Whether the creator may read visitor conversations. */
  | 'agent_share.disclosure'
  /** One person admitted to, or removed from, a share outside its link. */
  | 'agent_share.person_grant'
  /** The share was published (`link` / `card`), switched between them, paused or removed. */
  | 'agent_share.visibility';

/** The product surface a share mutation came from. */
export type AgentShareAuthorizationSource =
  /** The Agent's share settings. */
  | 'agent_share_settings'
  /** The owner's answer to someone's request to use the Agent, in a Channel. */
  | 'channel_access_request'
  /** A Workspace administrator's emergency stop from the share audit list. */
  | 'workspace_share_audit';

export interface AgentShareAuthorizationChange {
  /** The authorization this kind covers after the mutation; `null` when it was removed. */
  after: unknown;
  /** The authorization this kind covers before the mutation; `null` when there was none. */
  before: unknown;
  kind: AgentShareAuthorizationKind;
}

/** The notice a person confirmed before a mutation: which copy, which revision, in which language. */
export interface AgentShareAuthorizationNotice {
  /** Stable notice identifier, named after the kind it describes, e.g. `agent_share.device_access`. */
  id: string;
  locale?: string;
  /** Revision of the copy. */
  version: string;
}

/** Every authorization change one share mutation made. */
export interface AgentShareAuthorizationChangeSet {
  /** Who made the change; a Workspace administrator may act on another member's share. */
  actorUserId: string;
  agentId: string;
  changes: AgentShareAuthorizationChange[];
  /** The notice the actor confirmed for this mutation, if its surface showed one. */
  notice?: AgentShareAuthorizationNotice;
  /** The Workspace that owns the Agent, or `null` for a personal one. */
  workspaceId: string | null;
}

/**
 * Called inside a share mutation's transaction, after the change is applied and before it
 * commits, whenever the mutation changed at least one authorization. A rejection rolls the
 * mutation back.
 */
export type AgentShareAuthorizationObserver = (
  changeSet: AgentShareAuthorizationChangeSet,
) => Promise<void>;

// ==================== Snapshots ====================

/** `agent_share.visibility`: publishing also captures every grant it switches on. */
export interface AgentShareVisibilityAuthorizationSnapshot {
  capabilities?: AgentShareCapabilitiesAuthorizationSnapshot;
  deviceAccess?: AgentShareDeviceAccessAuthorizationSnapshot;
  disclosure?: AgentShareDisclosureAuthorizationSnapshot;
  shareId: string;
  visibility: string;
}

export interface AgentShareDeviceAccessAuthorizationSnapshot {
  deviceAccess: string;
  /** Sorted, so a reordered list is not reported as a change. */
  deviceAllowUserIds: string[];
  shareId: string;
}

export interface AgentShareCapabilitiesAuthorizationSnapshot {
  allowReadMemory: boolean;
  /**
   * A dynamic rule: every tool and skill the Agent turns on at run time, not the list resolved
   * when the creator agreed.
   */
  autoGrantAgentTools: boolean;
  /**
   * Tools and skills the creator withdrew from {@link autoGrantAgentTools}; sorted. Empty while it
   * is off, when declining grants nothing.
   */
  declinedGrantIds: string[];
  shareId: string;
  skillGrants: string[];
  toolGrants: { apis?: string[]; identifier: string }[];
}

export interface AgentShareDisclosureAuthorizationSnapshot {
  allowCreatorViewSessions: boolean;
  shareId: string;
}

export interface AgentSharePersonGrantAuthorizationSnapshot {
  shareId: string;
  /** How the person was admitted, e.g. `request` for an approved access request. */
  source?: string;
  userId: string;
}
