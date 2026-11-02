/**
 * Execution kinds supported by the Quick Note processing pipeline.
 *
 * `analyze` judges intent and produces a lightweight summary, and
 * `signal_enrichment` records context discovered by another system activity.
 * An explicit Dive is a Task, not a Run.
 */
export const QUICK_NOTE_RUN_KINDS = ['analyze', 'signal_enrichment'] as const;

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
 * Structured failure recorded on a terminal Quick Note Run.
 *
 * Stored as jsonb so callers can add diagnostic fields without a migration.
 * Must not contain secrets or full trace payloads.
 */
export interface QuickNoteRunError {
  [key: string]: unknown;
  /** Stable machine-readable failure code, when one is known. */
  code?: string;
  /** Human-readable failure summary. */
  message: string;
}

/**
 * Well-known roles for resources linked to a Quick Note.
 *
 * Only `context` exists today (an annotation is a resource plus selector). The
 * column stays a plain text value so future roles need no migration.
 */
export const QUICK_NOTE_RESOURCE_ROLES = ['context'] as const;

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

/**
 * Proposal kinds currently understood by Quick Note consumers.
 *
 * - `task`: create and run a Task (research preset)
 * - `topic`: open a Topic seeded with the note (discussion preset)
 * - `goal`: create a Goal
 * - `tool_call`: execute one tool call with fixed arguments (write-to-document preset)
 */
export const QUICK_NOTE_PROPOSAL_KINDS = ['task', 'topic', 'goal', 'tool_call'] as const;

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

/**
 * Full arguments of the downstream action a Proposal would execute.
 *
 * The shape depends on the Proposal kind and is validated by that kind's executor at apply time.
 * Users edit it in place; the AI draft is kept separately for diffing.
 */
export type QuickNoteProposalPayload = Record<string, unknown>;

/**
 * Rendered text inputs a Run consumed, stored on the Run itself.
 *
 * Stores text rather than revision pointers, so later edits or deletions of the note, comments,
 * or proposals never change what a past Run is recorded to have seen.
 */
export interface QuickNoteRunInputSnapshot {
  /** Comments present at claim time, oldest first. */
  comments: { content: string; id: string }[];
  /** Proposals still pending at claim time. */
  pendingProposals: {
    id: string;
    kind: QuickNoteProposalKind;
    payload: QuickNoteProposalPayload;
  }[];
  /** Plain-text projection of the pinned note source. */
  source: string;
  /** System Document History pinned as the Run's source revision. */
  sourceHistoryId: string;
}

/**
 * Top-level action labels the intent judgement scores independently.
 *
 * - `keep`: just keep the note (default and fallback)
 * - `enrich`: add a summary or background information
 * - `link`: associate existing product resources
 * - `delegate`: hand work off through a preset (Task, Topic, Goal, or tool call)
 */
export const QUICK_NOTE_ACTION_LABELS = ['keep', 'enrich', 'link', 'delegate'] as const;

/** One top-level action label of the Quick Note intent judgement. */
export type QuickNoteActionLabel = (typeof QUICK_NOTE_ACTION_LABELS)[number];

/** Discrete confidence score for one action label: 0 (no) to 4 (certain). */
export type QuickNoteActionScore = 0 | 1 | 2 | 3 | 4;

/** Built-in `delegate` presets; each maps to one Proposal kind. */
export const QUICK_NOTE_DELEGATE_PRESETS = [
  'research',
  'discuss',
  'goal',
  'write_document',
] as const;

/** A built-in `delegate` preset. */
export type QuickNoteDelegatePreset = (typeof QUICK_NOTE_DELEGATE_PRESETS)[number];

/** Intent judgement stored on the Analyze Run that produced it. */
export interface QuickNoteRunDecision {
  /**
   * How `ModelRuntime.decide` answered: `native` for a decision model (fractional scores),
   * `emulated` for a chat model through structured output (integer levels plus evidence).
   */
  decisionMode: 'emulated' | 'native';
  /** Model-written evidence for the primary label (and preset); empty for native decisions. */
  evidence: string;
  /**
   * Whether a Comment explicitly asks to turn the note into a Goal. A `goal` preset is only
   * selected when the `delegate` level is 4 or this is true.
   */
  explicitGoalRequest?: boolean;
  /** Model that produced the judgement. */
  model?: string | null;
  /** The `delegate` preset hit by the judgement, when any. */
  preset?: QuickNoteDelegatePreset | null;
  /**
   * 0–4 fit level per `delegate` preset, from its own `score` question (a rounded native mean or
   * an emulated integer level).
   */
  presetScores?: Partial<Record<QuickNoteDelegatePreset, QuickNoteActionScore>>;
  /** Highest-scoring label; `keep` on ties or when nothing else scores. */
  primary: QuickNoteActionLabel;
  /** Provider of {@link QuickNoteRunDecision.model}. */
  provider?: string | null;
  /** Question name to reason, for questions the model refused (they count as level 0 / no). */
  refusals?: Record<string, string>;
  /** Independent 0–4 level per action label. */
  scores: Record<QuickNoteActionLabel, QuickNoteActionScore>;
}

/** Built-in `delegate` preset to the Proposal kind it produces. */
export const QUICK_NOTE_PRESET_PROPOSAL_KINDS = {
  discuss: 'topic',
  goal: 'goal',
  research: 'task',
  write_document: 'tool_call',
} as const satisfies Record<QuickNoteDelegatePreset, QuickNoteProposalKind>;

/**
 * Provenance stamped on a Task created from a Quick Note (applied Proposal or Dive).
 *
 * Tasks carrying this source are listed in the Quick Note sidebar and hidden from task lists.
 */
export interface QuickNoteTaskSource {
  /** The applied Proposal, when the Task came from one; absent for Dive. */
  proposalId?: string;
  quickNoteId: string;
  /** The Analyze Run that proposed the Task, when any. */
  runId?: string;
  type: 'quick_note';
}
