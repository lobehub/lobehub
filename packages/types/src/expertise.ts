/**
 * Shared types for the SCLPT expertise system.
 *
 * The database schema, reflection tools, and frontend all consume these shapes, so their
 * contracts live here instead of being duplicated by each consumer.
 */

/**
 * One layer in an expertise-specific model. Layers are not a global taxonomy: different
 * expertises may use Cooper's three models, correctness/maintainability/security, or L1/L2/L3.
 */
export interface ExpertiseLayerDefinition {
  /** Canonical source for this layer. Omission means the layer was invented locally. */
  canonRef?: string;
  description?: string;
  /** Stable key referenced by lessons.layer and snapshots.layerCounts. */
  key: string;
  title: string;
}

export type ExpertiseEvidenceKind = 'image' | 'text' | 'diff' | 'json' | 'metric';

/**
 * Evidence expected from one practice run. A layer-scoped item is required only when that layer
 * runs. For example, a required L2 screenshot must exist before the run can make an L2 conclusion.
 */
export interface ExpertiseEvidenceSpecItem {
  key: string;
  kind: ExpertiseEvidenceKind;
  label: string;
  /** Require this item only for the specified layer; omit the layer to require it for every run. */
  layer?: string;
  required: boolean;
}

/**
 * Allowed section keys for each lesson polarity. Sections are optional and polarity-specific;
 * conversational revisions use the key to update one section without rewriting the others.
 */
export const EXPERTISE_SECTION_KEYS = {
  /** What is good / why it works / what not to regress into. */
  good: ['good', 'works', 'dont'],
  /** The criterion / why it matters / how to apply it / when it does not apply. */
  rule: ['rule', 'why', 'how', 'limits'],
  /** The wrong approach / why it is wrong / what it breaks / the correct approach. */
  bad: ['wrong', 'why', 'breaks', 'correct'],
} as const;

export type ExpertiseLessonPolarity = keyof typeof EXPERTISE_SECTION_KEYS;
export type ExpertiseLessonSectionKey =
  (typeof EXPERTISE_SECTION_KEYS)[ExpertiseLessonPolarity][number];

export interface ExpertiseLessonSection {
  body: string;
  /** One of the section keys allowed by the lesson's polarity. */
  key: ExpertiseLessonSectionKey;
}

/** Schema version for operation-scoped expertise snapshots. */
export const EXPERTISE_CONTEXT_SCHEMA_VERSION = 1;

/** Immutable expertise context captured once when an agent operation starts. */
export interface ExpertiseContextSnapshot {
  /** Hash of the rendered context, used to verify that every step sees the same snapshot. */
  contentHash: string;
  /** Stable domain and lesson identities retained for tracing and post-run attribution. */
  domains: ExpertiseContextSnapshotDomain[];
  /** Prompt-ready context reused verbatim for every LLM call in the operation. */
  renderedContext: string;
  /** Server-side snapshot schema version. This value is not rendered into the prompt. */
  schemaVersion: number;
}

export interface ExpertiseContextSnapshotDomain {
  id: string;
  lessonIds: string[];
}

/**
 * One referenceable entry in an expertise canon. Canon entries must be addressable: when the canon
 * was stored as one prose string, lessons could not reliably populate canonAnchor.
 *
 * Entries stay in JSONB, like layers, because each expertise owns a small fixed set that is always
 * read together for prompt injection and coverage calculation, with no cross-expertise reuse.
 */
export interface ExpertiseCanonEntry {
  /** Stable identifier referenced by lessons.canonAnchor. */
  key: string;
  /** Book, framework, or methodology that defines this entry. */
  source: string;
  /** The general principle explaining why this failure recurs across similar work. */
  statement: string;
  title: string;
}

/**
 * One candidate expertise proposed during anchoring.
 *
 * An expertise is selected rather than discovered: the same agent may plausibly anchor as either a
 * technical-intelligence analyst or a paper reviewer, each with a different canon and layer model.
 * Preserve all candidates so a person can choose and revisit the alternatives later.
 */
export interface ExpertiseAnchorCandidate {
  canonEntries: ExpertiseCanonEntry[];
  domainFilter: string;
  evidenceSpec?: ExpertiseEvidenceSpecItem[];
  flow?: string[];
  key: string;
  layerCanonRef?: string;
  layers: ExpertiseLayerDefinition[];
  layerSource: 'canonical' | 'invented';
  outOfScope?: string;
  /** Why this candidate was inferred from the source material, for the person choosing an anchor. */
  rationale?: string;
  title: string;
}

export type ExpertiseInsightEvidenceType = 'lesson' | 'run' | 'hit' | 'topic' | 'operation';

export interface ExpertiseInsightEvidenceRef {
  ids: string[];
  type: ExpertiseInsightEvidenceType;
}

/**
 * Whether a standard rests on something observable or on the owner's preference.
 *
 * Both are legitimate — a reviewer is allowed to just want things a certain way — but only one of
 * them can be enforced automatically. A taste standard has no test a delivery could be measured
 * against, so compiling it into a criterion that blocks work on its own would be enforcing a
 * preference as if it were a fact.
 */
export type ExpertiseReasonKind = 'mechanism' | 'taste';

/**
 * Whether the reviewer gave the reason or the distillation supplied it.
 *
 * An inferred reason is worth keeping — the mechanism is what lets a standard reach a screen
 * nobody has built yet — but it must never read as something the reviewer said, because a reason
 * carries weight downstream that an invented one has not earned.
 */
export type ExpertiseReasonSource = 'inferred' | 'reviewer';

/**
 * What a backtest concluded about one lesson.
 *
 * `ready` does not mean the standard is correct — it means firing it would not have contradicted
 * the reviewer on the history we can see.
 */
export type ExpertiseBacktestVerdict = 'ready' | 'too-broad' | 'insufficient-evidence';

/**
 * How a distilled standard scored against the reviewer's own past decisions.
 *
 * Read the numbers, not the name: measuring this on 898 of one reviewer's circled rejections showed
 * the score cannot be used as a gate, because the labels it scores against are incomplete. A
 * reviewer circles the one or two worst things in a delivery, so a standard that correctly spots a
 * real defect they did not circle that time is counted a false alarm. Concretely: standards fired on
 * 25 of 44 rejections from the same category, but matched what the reviewer had actually written on
 * 4 — while firing on 39% of deliveries they accepted. Neither number separates a good standard
 * from a bad one.
 *
 * So nothing writes this column yet, and nothing should gate on `verdict` until a measurement with
 * unbiased labels exists — the candidate being forward measurement, where a standard is injected
 * without blocking and what is counted is how often the reviewer overrides it once it has fired.
 * Kept as a column because that measurement still belongs on the lesson.
 */
export interface ExpertiseBacktestResult {
  /** ISO 8601. */
  computedAt: string;
  /** Units it flagged that the reviewer had in fact accepted — the cost of compiling it. */
  falseAlarms: number;
  /** Units the standard flagged, out of `sampled`. */
  fired: number;
  /**
   * `fired` is low-information on its own: a standard nobody could violate scores a perfect
   * precision on two units. The verdict requires a floor.
   */
  precision: number;
  /** Prompt version behind the judgements, so scores from different wordings never get pooled. */
  promptVersion: string;
  /** Historical judged units put in front of the model, excluding the ones that taught it. */
  sampled: number;
  verdict: ExpertiseBacktestVerdict;
}

/**
 * What one consolidation pass read, and what each boundary it wrote rests on.
 *
 * A rewritten standard is only as trustworthy as the deliveries behind it, and the rewrite text
 * cannot carry that: the model cites deliveries by per-request labels ("S2") that mean nothing once
 * the request is gone. Ids are resolved before they are stored, so an exemption can always be
 * walked back to the delivery the reviewer let through.
 */
export interface ExpertiseRevisionEvidence {
  /**
   * Each exemption written into `limits`, with the accepted deliveries it was read from. Never
   * empty per entry: a boundary that cannot name a delivery the reviewer shipped is invented, and
   * is dropped before it gets here.
   */
  boundaries: { checkResultIds: string[]; limit: string }[];
  /** Rejected deliveries (`verify_check_results` ids) the pass restated the standard from. */
  instances: string[];
  /**
   * Accepted deliveries offered as the contrast set. Kept even when no boundary was found, so
   * "no boundary" can be read as "none among these" rather than "never looked".
   */
  shipped: string[];
}
