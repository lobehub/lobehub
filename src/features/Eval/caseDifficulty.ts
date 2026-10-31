/** Four tiers, L1 (easiest) to L4, read from the release's difficulty score. */
export const CASE_LEVELS = ['L1', 'L2', 'L3', 'L4'] as const;
export type CaseLevel = (typeof CASE_LEVELS)[number];

/**
 * The release grades a case by counting contract signals (calls in order,
 * services spanned, injected failure, forbidden calls, conversation context,
 * Memory fixture, rule count, procedure length). The score maps to a tier:
 * L1 ≤ 1 · L2 2–3 · L3 4–5 · L4 ≥ 6.
 */
export const levelFromScore = (score: number): CaseLevel =>
  score <= 1 ? 'L1' : score <= 3 ? 'L2' : score <= 5 ? 'L3' : 'L4';

/** Labels older releases wrote; without a score an "Advanced" case cannot be split into L3/L4. */
const LEGACY_LEVELS: Record<string, CaseLevel> = {
  Advanced: 'L3',
  Intermediate: 'L2',
  Starter: 'L1',
};

interface CaseWithDifficulty {
  metadata?: unknown;
}

interface CaseDifficultyDetails {
  level?: string;
  score?: number;
  signals?: string[];
}

export type CaseDifficultyLabel =
  { kind: 'level'; level: CaseLevel } | { kind: 'legacy'; value: 'easy' | 'hard' | 'medium' };

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const isCaseLevel = (value: unknown): value is CaseLevel =>
  CASE_LEVELS.includes(value as CaseLevel);

const toLevel = (value: unknown): CaseLevel | undefined =>
  isCaseLevel(value) ? value : typeof value === 'string' ? LEGACY_LEVELS[value] : undefined;

/**
 * The case's tier: from the release's difficulty score when it carries one,
 * otherwise from the level label the release wrote (legacy names included).
 */
export const getCaseLevel = (testCase: CaseWithDifficulty): CaseLevel | undefined => {
  const metadata = asRecord(testCase.metadata);
  const details = asRecord(metadata?.difficulty);
  if (typeof details?.score === 'number') return levelFromScore(details.score);
  return toLevel(metadata?.level) ?? toLevel(details?.level);
};

/** Why the case got its level: the contract signals the release's rubric counted. */
export const getCaseDifficulty = (
  testCase: CaseWithDifficulty,
): CaseDifficultyDetails | undefined =>
  asRecord(asRecord(testCase.metadata)?.difficulty) as CaseDifficultyDetails | undefined;

/** Keep release levels and legacy easy/medium/hard labels as distinct classifications. */
export const resolveCaseDifficulty = (metadata: unknown): CaseDifficultyLabel | undefined => {
  const level = getCaseLevel({ metadata });
  if (level) return { kind: 'level', level };

  const legacy = asRecord(metadata)?.difficulty;
  if (legacy === 'easy' || legacy === 'medium' || legacy === 'hard') {
    return { kind: 'legacy', value: legacy };
  }
  return undefined;
};

/** The translation key of a level's label (typed, so `t` accepts it). */
export const levelLabelKey = (level: CaseLevel) => `lobeBench.case.level.${level}` as const;

export const levelTagColor = (level: CaseLevel) =>
  level === 'L1' ? 'success' : level === 'L2' ? 'processing' : level === 'L3' ? 'warning' : 'error';
