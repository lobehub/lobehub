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

const EXPERTISE_TITLE_MAX = 18;

/**
 * Turns the user's one-sentence description into the editable draft shown before creation.
 * The domain filter deliberately remains verbatim: it is the user's acceptance rule, not copy.
 */
export const parseExpertiseDomainBrief = (value: string) => {
  const brief = value.trim();
  const firstClause = brief.split(/[。；;\n，,]/)[0]?.trim() || brief;
  const stripped = firstClause
    .replace(/^(我想|我希望|希望|想)?(让|把)?(它|他|这个\s*agent|agent)?/i, '')
    .replace(/^(在|对|针对|关于)/, '')
    .replace(/(上|方面|这块|这件事)?(变强|更强|更专业|更好|做得更好|积累经验|学习|成长)。?$/, '')
    .trim();
  const rawTitle = stripped || firstClause;

  return {
    domainFilter: brief,
    title:
      rawTitle.length > EXPERTISE_TITLE_MAX
        ? `${rawTitle.slice(0, EXPERTISE_TITLE_MAX)}…`
        : rawTitle,
  };
};

export type ExpertiseInsightEvidenceType = 'lesson' | 'run' | 'hit' | 'topic' | 'operation';

export interface ExpertiseInsightEvidenceRef {
  ids: string[];
  type: ExpertiseInsightEvidenceType;
}
