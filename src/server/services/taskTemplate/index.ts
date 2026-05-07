import {
  TASK_TEMPLATE_FALLBACK_CATEGORIES,
  type TaskTemplate,
  taskTemplates,
  type TaskTemplateSkillSource,
} from '@lobechat/const';

import { klavisEnv } from '@/config/klavis';
import { appEnv } from '@/envs/app';

export const RECOMMEND_COUNT = 3;

export const ENABLED_SKILL_SOURCES: ReadonlySet<TaskTemplateSkillSource> = (() => {
  const sources = new Set<TaskTemplateSkillSource>();
  if (klavisEnv.KLAVIS_API_KEY) sources.add('klavis');
  if (appEnv.MARKET_TRUSTED_CLIENT_ID && appEnv.MARKET_TRUSTED_CLIENT_SECRET) {
    sources.add('lobehub');
  }
  return sources;
})();

const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
};

/** mulberry32 — pure function of seed, used so recommendations are stable per user/day. */
const mulberry32 = (seed: number) => {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d_2b_79_f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const seededShuffle = <T>(items: T[], seed: number): T[] => {
  const arr = [...items];
  const rand = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const normalize = (s: string) => s.trim().toLowerCase();

const hasIntersection = (template: TaskTemplate, userInterests: string[]): boolean => {
  if (userInterests.length === 0) return false;
  const normalized = new Set(userInterests.map(normalize));
  return template.interests.some((i) => normalized.has(normalize(i)));
};

const getUtcDateStr = (now: Date): string => now.toISOString().slice(0, 10);

/**
 * A template is eligible only if every `requiresSkills[].source` is enabled
 * server-side. When a template declares no skill requirement, it is always
 * eligible. When the caller passes no `enabledSkillSources` set, any template
 * with skill requirements is filtered out (conservative default).
 */
export const isTemplateSkillSourceEligible = (
  template: TaskTemplate,
  enabledSkillSources?: ReadonlySet<TaskTemplateSkillSource>,
): boolean => {
  if (!template.requiresSkills || template.requiresSkills.length === 0) return true;
  if (!enabledSkillSources) return false;
  return template.requiresSkills.every((s) => enabledSkillSources.has(s.source));
};

export class TaskTemplateService {
  constructor(private userId: string) {}

  /**
   * Client resolves user.interests (localized labels or raw values) to
   * INTEREST_AREAS keys before calling — see useResolvedInterestKeys in the UI.
   */
  async listDailyRecommend(
    interestKeys: string[],
    options: {
      enabledSkillSources?: ReadonlySet<TaskTemplateSkillSource>;
      excludeIds?: string[];
      now?: Date;
    } = {},
  ): Promise<TaskTemplate[]> {
    const { enabledSkillSources, excludeIds, now = new Date() } = options;
    const excluded = new Set(excludeIds ?? []);
    const seed = hashString(`${this.userId}:${getUtcDateStr(now)}`);

    const candidates = taskTemplates.filter(
      (t) => !excluded.has(t.id) && isTemplateSkillSourceEligible(t, enabledSkillSources),
    );
    const matched = candidates.filter((t) => hasIntersection(t, interestKeys));
    const result: TaskTemplate[] = seededShuffle(matched, seed).slice(0, RECOMMEND_COUNT);

    const takeFrom = (pool: TaskTemplate[]) => {
      if (result.length >= RECOMMEND_COUNT) return;
      const seen = new Set(result.map((t) => t.id));
      const remaining = pool.filter((t) => !seen.has(t.id));
      result.push(...seededShuffle(remaining, seed).slice(0, RECOMMEND_COUNT - result.length));
    };

    takeFrom(candidates.filter((t) => TASK_TEMPLATE_FALLBACK_CATEGORIES.includes(t.category)));
    takeFrom(candidates);

    return result;
  }
}
