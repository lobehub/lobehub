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
