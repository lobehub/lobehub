/**
 * Execution kinds supported by the Quick Note processing pipeline.
 *
 * `analyze` performs lightweight annotation, `signal_enrichment` records
 * context discovered by another system activity, and `dive` performs an
 * explicit user-requested investigation.
 */
export const QUICK_NOTE_RUN_KINDS = ['analyze', 'signal_enrichment', 'dive'] as const;

/** A processing mode recorded by an immutable Quick Note Run. */
export type QuickNoteRunKind = (typeof QUICK_NOTE_RUN_KINDS)[number];

/** Provenance values explaining why Quick Note Analyze started. */
export const QUICK_NOTE_ANALYZE_TRIGGERS = ['automatic', 'manual', 'signal', 'retry'] as const;

/** The event provenance recorded by an immutable Analyze Run. */
export type QuickNoteAnalyzeTrigger = (typeof QUICK_NOTE_ANALYZE_TRIGGERS)[number];

/** Non-secret Agent configuration pinned to one Quick Note Run. */
export interface QuickNoteRunExecutionConfig {
  /** Stable Agent used by the Run after builtin or custom binding resolution. */
  agentId: string;
  /** Builtin slug when the resolved Agent is a product-managed Agent. */
  agentSlug?: string | null;
  /** Maximum runtime steps allowed for this Run. */
  maxSteps: number;
  /** Model selected after Agent configuration resolution. */
  model?: string | null;
  /** Plugin identifiers available to the Agent. */
  pluginIds: string[];
  /** Provider selected after Agent configuration resolution. */
  provider?: string | null;
  /** Web-search policy resolved from the Analyzer Agent at Run startup. */
  searchMode?: 'auto' | 'off' | 'on';
  /** Tool-selection mode resolved from the Analyzer Agent at Run startup. */
  toolMode?: 'agent' | 'chat' | 'custom';
  /** Whether the resolved Agent prefers provider-native search over the application search tool. */
  useModelBuiltinSearch?: boolean;
}

/** Lifecycle values for a Quick Note Run. */
export const QUICK_NOTE_RUN_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'canceled',
  'superseded',
] as const;

/** The persisted lifecycle state of a Quick Note Run. */
export type QuickNoteRunStatus = (typeof QUICK_NOTE_RUN_STATUSES)[number];

/**
 * Well-known roles for Documents linked to a Quick Note.
 *
 * This is intentionally not a closed union at the database boundary: future
 * agents may add new resource roles without a migration.
 */
export const QUICK_NOTE_RESOURCE_ROLES = ['annotation', 'context'] as const;

/** A well-known semantic role for a Quick Note Resource. */
export type QuickNoteResourceRole = (typeof QUICK_NOTE_RESOURCE_ROLES)[number];

/** Canonical product objects that can be annotated or referenced by a Quick Note. */
export const QUICK_NOTE_RESOURCE_TYPES = [
  'conversation',
  'document',
  'message',
  'page',
  'resource',
  'task',
  'thread',
  'topic',
  'turn',
] as const;

/** A canonical product object family referenced by a Quick Note Resource Link. */
export type QuickNoteResourceType = (typeof QUICK_NOTE_RESOURCE_TYPES)[number];

/** A typed resource reference returned by a Quick Note Agent. */
export interface QuickNoteResourceReference {
  /** Stable identifier in the referenced product domain. */
  id: string;
  /** Optional resource-native selection, such as a quoted message range. */
  selector?: Record<string, unknown>;
  /** Canonical product object family. */
  type: QuickNoteResourceType;
}

/** Proposal kinds currently understood by Quick Note consumers. */
export const QUICK_NOTE_PROPOSAL_KINDS = ['task'] as const;

/** A downstream action shape suggested without executing it. */
export type QuickNoteProposalKind = (typeof QUICK_NOTE_PROPOSAL_KINDS)[number];

/** User decision states for a Quick Note Proposal. */
export const QUICK_NOTE_PROPOSAL_DECISION_STATUSES = ['pending', 'accepted', 'dismissed'] as const;

/** The user's decision about a Quick Note Proposal. */
export type QuickNoteProposalDecisionStatus =
  (typeof QUICK_NOTE_PROPOSAL_DECISION_STATUSES)[number];

/** Source-validity states kept separate from the user's decision. */
export const QUICK_NOTE_PROPOSAL_VALIDITIES = ['current', 'stale', 'superseded'] as const;

/** Whether a Proposal still describes the current Quick Note source. */
export type QuickNoteProposalValidity = (typeof QUICK_NOTE_PROPOSAL_VALIDITIES)[number];

/** Semantic roles for immutable inputs consumed by a Quick Note Run. */
export const QUICK_NOTE_RUN_INPUT_ROLES = ['source', 'comment', 'proposal', 'resource'] as const;

/** The role an immutable content revision played in a Quick Note Run. */
export type QuickNoteRunInputRole = (typeof QUICK_NOTE_RUN_INPUT_ROLES)[number];
