import type { ExpertiseDomainItem, ExpertiseHabit } from '@/services/expertise';

/**
 * 可靠度分档 —— 页面的感知单位是「习惯 + 它靠不靠谱」，不是「学到几条」。
 * 全部由 hits.outcome（pass / violation）折出来；阈值集中在这一处。
 *
 *   recurring 老毛病  有规则却反复违反（近期 ≥2 次 violation）
 *   shaky     还不稳  近期 1 次 violation
 *   fresh     刚学的  命中太少（<2），还没检验
 *   stable    已养成  近期全 pass
 */
export type HabitTier = 'fresh' | 'recurring' | 'shaky' | 'stable';

export const TIER_ORDER: HabitTier[] = ['recurring', 'shaky', 'fresh', 'stable'];

export const habitTier = (recent: { pass: boolean }[]): HabitTier => {
  if (recent.length < 2) return 'fresh';
  const bad = recent.filter((r) => !r.pass).length;
  if (bad >= 2) return 'recurring';
  if (bad === 1) return 'shaky';
  return 'stable';
};

export type TierCounts = Record<HabitTier, number>;

export const emptyCounts = (): TierCounts => ({ fresh: 0, recurring: 0, shaky: 0, stable: 0 });

export const countTiers = (habits: ExpertiseHabit[]): TierCounts => {
  const c = emptyCounts();
  for (const h of habits) c[habitTier(h.recent)] += 1;
  return c;
};

/** User-facing layer labels stay sequential; domain layer keys are internal identifiers. */
export const layerLabel = (index: number) => `L${index + 1}`;

/** 一层 / 一个方向的一句话评语，从分档数推出来。 */
export type ProfileWord = 'fresh' | 'mostlyStable' | 'stable' | 'unstable' | 'weak';

export const profileWord = (c: TierCounts, total: number): ProfileWord => {
  if (total === 0) return 'fresh';
  if (c.recurring > 0) return 'weak';
  if (c.shaky > 0) return 'unstable';
  if (c.fresh === total) return 'fresh';
  if (c.stable === total) return 'stable';
  return 'mostlyStable';
};

/** 做对率序列：只有真的命中过习惯的实践才有一个点。 */
export const passRateSeries = (reliability: ExpertiseDomainItem['reliability']) =>
  reliability
    .filter((r) => r.pass + r.violation > 0)
    .map((r) => ({ rate: r.pass / (r.pass + r.violation), run: r.run }));

/** 连续零错的实践次数（从最近往前数）。 */
export const zeroViolationStreak = (reliability: ExpertiseDomainItem['reliability']) => {
  let n = 0;
  for (let i = reliability.length - 1; i >= 0; i--) {
    if (reliability[i].violation === 0 && reliability[i].pass > 0) n += 1;
    else break;
  }
  return n;
};

/** 最近 k 个点的平均做对率；不足 k 个就用全部。 */
export const recentPassRate = (series: { rate: number }[], k = 4) => {
  const tail = series.slice(-k);
  if (tail.length === 0) return null;
  return tail.reduce((a, b) => a + b.rate, 0) / tail.length;
};

export const earlyPassRate = (series: { rate: number }[], k = 4) => {
  const head = series.slice(0, k);
  if (head.length === 0) return null;
  return head.reduce((a, b) => a + b.rate, 0) / head.length;
};

/**
 * Section labels per polarity: `bad` writes wrong/why/breaks/correct, `good` good/works/dont,
 * `rule` rule/why/how/limits. One map covers all three so every surface labels them the same.
 */
export const LESSON_SECTION_LABELS = {
  breaks: 'rules.section.breaks',
  correct: 'rules.section.correct',
  dont: 'rules.section.dont',
  good: 'rules.section.good',
  how: 'rules.section.how',
  limits: 'rules.section.limits',
  rule: 'rules.section.rule',
  why: 'rules.section.why',
  works: 'rules.section.works',
  wrong: 'rules.section.wrong',
} as const;

export type LessonSectionKey = keyof typeof LESSON_SECTION_LABELS;

/** `undefined` for a section key no polarity declares; callers fall back to the raw key. */
export const lessonSectionLabel = (key: string) =>
  LESSON_SECTION_LABELS[key as LessonSectionKey] as
    (typeof LESSON_SECTION_LABELS)[LessonSectionKey] | undefined;

/** Worth reading at a glance; `rule` only restates the title the surface already shows. */
const PREVIEW_SECTION_KEYS = new Set(['why', 'how', 'works', 'breaks', 'correct', 'limits']);

/**
 * The sections a hover preview shows, already paired with their label key.
 * Empty bodies are dropped so the card never renders a labelled blank row.
 */
export const previewSections = (sections: { body: string; key: string }[] = []) =>
  sections
    .filter((section) => PREVIEW_SECTION_KEYS.has(section.key) && section.body.trim().length > 0)
    .map((section) => ({ ...section, label: lessonSectionLabel(section.key) }));
