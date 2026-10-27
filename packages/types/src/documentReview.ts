/**
 * Shared domain types for document review: change-impact analysis (which
 * definitions / references / clauses / obligations a revision may affect) and
 * the rule-based check list (Verifier).
 *
 * Columns that store these literals are plain `text` typed via `.$type<>()`, so
 * adding a value here is a type-only change with no migration.
 */

// ---------------------------------------------------------------------------
// Review session
// ---------------------------------------------------------------------------

export const DOCUMENT_REVIEW_SESSION_STATUSES = ['active', 'archived'] as const;
export type DocumentReviewSessionStatus = (typeof DOCUMENT_REVIEW_SESSION_STATUSES)[number];

/**
 * A text-quote anchor into a document body. Text selectors survive editor
 * reloads (Lexical regenerates node keys), and `quote` doubles as the excerpt
 * shown when the run has since been edited away.
 */
export interface DocumentReviewTextAnchor {
  /** Offset just past the quote at capture time; a re-location hint only. */
  end?: number;
  /**
   * The quote could not be found in the current body when the analysis was
   * persisted. The anchor is kept (not dropped) so the excerpt the model quoted
   * stays visible; the UI must not offer a jump for it.
   */
  invalid?: boolean;
  /** Optional human label of the location, e.g. "§4.2 Acceptance". */
  label?: string;
  prefix?: string;
  quote: string;
  /** Offset of the quote at capture time; a re-location hint only. */
  start?: number;
  suffix?: string;
}

// ---------------------------------------------------------------------------
// Impact items
// ---------------------------------------------------------------------------

/** What kind of document element the change may affect. */
export const DOCUMENT_REVIEW_IMPACT_KINDS = [
  'definition',
  'reference',
  'related_clause',
  'obligation',
] as const;
export type DocumentReviewImpactKind = (typeof DOCUMENT_REVIEW_IMPACT_KINDS)[number];

/**
 * `textual` — a direct wording difference between the two versions.
 * `semantic` — a potential meaning-level impact on text that did not change
 * (e.g. final acceptance → staged acceptance affects the payment trigger).
 */
export const DOCUMENT_REVIEW_IMPACT_CATEGORIES = ['textual', 'semantic'] as const;
export type DocumentReviewImpactCategory = (typeof DOCUMENT_REVIEW_IMPACT_CATEGORIES)[number];

export const DOCUMENT_REVIEW_IMPACT_SEVERITIES = ['high', 'medium', 'low'] as const;
export type DocumentReviewImpactSeverity = (typeof DOCUMENT_REVIEW_IMPACT_SEVERITIES)[number];

export const DOCUMENT_REVIEW_IMPACT_STATUSES = [
  'open',
  'acknowledged',
  'resolved',
  'dismissed',
] as const;
export type DocumentReviewImpactStatus = (typeof DOCUMENT_REVIEW_IMPACT_STATUSES)[number];

export interface DocumentReviewImpactInput {
  category: DocumentReviewImpactCategory;
  /**
   * Model confidence (0..1) that this element is affected. Null for items
   * written by hand before the analysis produced a score.
   */
  confidence?: number | null;
  kind: DocumentReviewImpactKind;
  /** The judgement basis: why this element may be affected. */
  reason: string;
  /** Affected original text elsewhere in the document. */
  relatedAnchor?: DocumentReviewTextAnchor | null;
  severity?: DocumentReviewImpactSeverity;
  /** The changed clause that triggers this impact. */
  sourceAnchor?: DocumentReviewTextAnchor | null;
  title: string;
  /** Human description of the change that triggers this impact. */
  trigger?: string | null;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * A rule set is `draft` while the user is still defining it and becomes
 * `confirmed` once the user accepts it. Only confirmed rule sets can be checked;
 * editing a confirmed set returns it to `draft`.
 */
export const DOCUMENT_REVIEW_RULE_SET_STATUSES = ['draft', 'confirmed'] as const;
export type DocumentReviewRuleSetStatus = (typeof DOCUMENT_REVIEW_RULE_SET_STATUSES)[number];

export const DOCUMENT_REVIEW_RULE_SEVERITIES = ['high', 'medium', 'low'] as const;
export type DocumentReviewRuleSeverity = (typeof DOCUMENT_REVIEW_RULE_SEVERITIES)[number];

export interface DocumentReviewRuleInput {
  /** What the agent must check, in natural language. */
  instruction: string;
  severity?: DocumentReviewRuleSeverity;
  title: string;
}

// ---------------------------------------------------------------------------
// Check results
// ---------------------------------------------------------------------------

export const DOCUMENT_REVIEW_CHECK_STATUSES = [
  'passed',
  'failed',
  'uncertain',
  'unchecked',
  'needs_recheck',
] as const;
export type DocumentReviewCheckStatus = (typeof DOCUMENT_REVIEW_CHECK_STATUSES)[number];

/** Outcomes a (re-)check may produce. The only way to reach `passed`. */
export const DOCUMENT_REVIEW_CHECK_OUTCOMES = ['passed', 'failed', 'uncertain'] as const;
export type DocumentReviewCheckOutcome = (typeof DOCUMENT_REVIEW_CHECK_OUTCOMES)[number];

/**
 * Events that move a check result between statuses. Clients never write a
 * status directly; they submit an event and the server derives the next status.
 *
 * - `check`            — the agent (re-)checked the rule; needs an outcome.
 * - `apply_suggestion` — a fix was applied to the document → `needs_recheck`.
 * - `invalidate`       — the document or rule changed since the last check.
 * - `reset`            — discard the result → `unchecked`.
 */
export const DOCUMENT_REVIEW_CHECK_EVENTS = [
  'check',
  'apply_suggestion',
  'invalidate',
  'reset',
] as const;
export type DocumentReviewCheckEvent = (typeof DOCUMENT_REVIEW_CHECK_EVENTS)[number];

export interface DocumentReviewCheckSuggestion {
  /** Text to replace; usually equals one evidence quote. */
  original: string;
  /** Proposed replacement; user-editable before applying. */
  replacement: string;
}
