/**
 * Evidence that a person actively granted, widened, narrowed or withdrew something: who acted,
 * when, from which client and IP, what they saw, and the authorization before and after.
 *
 * One append-only ledger serves every such decision. Add a kind (and, when it needs one, a
 * source) here; the column stays plain text, so a new kind needs no migration.
 */
export type ConsentEventKind =
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

/** The product surface the decision was made on. */
export type ConsentEventSource =
  /** The Agent's share settings. */
  | 'agent_share_settings'
  /** The owner's answer to someone's request to use the Agent, in a Channel. */
  | 'channel_access_request'
  /**
   * Server code that changed an authorization without a request behind it (a script, a job, a
   * caller not yet wired to pass its request). Still records the actor and the change, but no
   * client facts.
   */
  | 'server'
  /** A Workspace administrator's emergency stop from the share audit list. */
  | 'workspace_share_audit';

export type ConsentEventResourceType = 'agent';

/**
 * The client the request claimed to come from, parsed from its user agent
 * (`parseClientMetadata`). A claim, not an attested device identity.
 */
export interface ConsentEventClient {
  app?: string;
  platform?: string;
  type: string;
  version?: string;
}

/** The notice the person confirmed before deciding: which copy, which revision, in which language. */
export interface ConsentNotice {
  /** Stable notice identifier, e.g. `agent_share.device_access`. */
  id: string;
  locale?: string;
  /** Revision of the copy; bump it whenever the wording of the notice changes. */
  version: string;
}

/**
 * Request facts captured where the decision arrives (a tRPC procedure) and recorded with every
 * event the decision produces. The acting user is supplied separately by the writer.
 */
export interface ConsentRequestContext {
  client?: ConsentEventClient;
  ipAddress?: string | null;
  notice?: ConsentNotice;
  source: ConsentEventSource;
  userAgent?: string | null;
}

/** One `user_consent_events` row; checked against the table in the schema package. */
export interface UserConsentEvent {
  actorUserId: string;
  /** The authorization this kind covers after the decision; `null` when it was removed. */
  after: unknown;
  /** The authorization this kind covers before the decision; `null` when there was none. */
  before: unknown;
  client: ConsentEventClient | null;
  createdAt: Date;
  id: string;
  ipAddress: string | null;
  kind: ConsentEventKind;
  notice: ConsentNotice | null;
  resourceId: string | null;
  resourceType: ConsentEventResourceType | null;
  source: ConsentEventSource;
  userAgent: string | null;
  workspaceId: string | null;
}

/** What inserting a `user_consent_events` row takes; columns with a default are optional. */
export interface UserConsentEventInsert {
  actorUserId: string;
  after?: unknown;
  before?: unknown;
  client?: ConsentEventClient | null;
  createdAt?: Date;
  id?: string;
  ipAddress?: string | null;
  kind: ConsentEventKind;
  notice?: ConsentNotice | null;
  resourceId?: string | null;
  resourceType?: ConsentEventResourceType | null;
  source: ConsentEventSource;
  userAgent?: string | null;
  workspaceId?: string | null;
}

// ==================== Agent Share snapshots ====================

/** `agent_share.visibility`: publishing also captures every grant it switches on. */
export interface AgentShareVisibilityConsentSnapshot {
  capabilities?: AgentShareCapabilitiesConsentSnapshot;
  deviceAccess?: AgentShareDeviceAccessConsentSnapshot;
  disclosure?: AgentShareDisclosureConsentSnapshot;
  shareId: string;
  visibility: string;
}

export interface AgentShareDeviceAccessConsentSnapshot {
  deviceAccess: string;
  /** Sorted, so a reordered list is not recorded as a change. */
  deviceAllowUserIds: string[];
  shareId: string;
}

export interface AgentShareCapabilitiesConsentSnapshot {
  allowReadMemory: boolean;
  /**
   * A dynamic rule: every tool and skill the Agent turns on at run time, not the list resolved
   * when the creator agreed.
   */
  autoGrantAgentTools: boolean;
  /** Tools and skills the creator withdrew from {@link autoGrantAgentTools}; sorted. */
  declinedGrantIds: string[];
  shareId: string;
  skillGrants: string[];
  toolGrants: { apis?: string[]; identifier: string }[];
}

export interface AgentShareDisclosureConsentSnapshot {
  allowCreatorViewSessions: boolean;
  shareId: string;
}

export interface AgentSharePersonGrantConsentSnapshot {
  shareId: string;
  /** How the person was admitted, e.g. `request` for an approved access request. */
  source?: string;
  userId: string;
}
