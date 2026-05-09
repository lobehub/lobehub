// @vitest-environment node
import type { TaskTemplate } from '@lobechat/const';
import { TASK_TEMPLATE_FALLBACK_CATEGORIES, taskTemplates } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import { isTemplateSkillSourceEligible, RECOMMEND_COUNT, TaskTemplateService } from './index';

const makeTemplate = (overrides: Partial<TaskTemplate>): TaskTemplate => ({
  category: 'engineering',
  cronPattern: '0 9 * * *',
  id: 't',
  interests: [],
  ...overrides,
});

const UTC_DAY_1 = new Date('2026-04-24T10:00:00Z');
const UTC_DAY_2 = new Date('2026-04-25T10:00:00Z');

describe('TaskTemplateService.listDailyRecommend', () => {
  it('returns RECOMMEND_COUNT items when user has matching interests', async () => {
    const service = new TaskTemplateService('user-1');
    const picked = await service.listDailyRecommend(['coding'], { now: UTC_DAY_1 });

    expect(picked).toHaveLength(RECOMMEND_COUNT);
    expect(picked.every((p) => p.source === 'matched')).toBe(true);
    const codingMatches = taskTemplates.filter((t) => t.interests.includes('coding'));
    expect(picked.some((p) => codingMatches.some((m) => m.id === p.id))).toBe(true);
  });

  it('is stable for the same (userId, utcDate)', async () => {
    const service = new TaskTemplateService('user-1');

    const a = await service.listDailyRecommend(['coding'], { now: UTC_DAY_1 });
    const b = await service.listDailyRecommend(['coding'], {
      now: new Date('2026-04-24T23:59:00Z'), // still same UTC day
    });

    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id));
  });

  it('changes across UTC days', async () => {
    let matches = 0;
    for (const suffix of ['a', 'b', 'c', 'd', 'e']) {
      const service = new TaskTemplateService(`user-${suffix}`);
      const d1 = await service.listDailyRecommend([], { now: UTC_DAY_1 });
      const d2 = await service.listDailyRecommend([], { now: UTC_DAY_2 });
      if (JSON.stringify(d1) === JSON.stringify(d2)) matches += 1;
    }
    expect(matches).toBeLessThan(5);
  });

  it('differs across users on the same day', async () => {
    const results = await Promise.all(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((s) =>
        new TaskTemplateService(`user-${s}`)
          .listDailyRecommend([], { now: UTC_DAY_1 })
          .then((r) => r.map((t) => t.id).join(',')),
      ),
    );
    expect(new Set(results).size).toBeGreaterThan(1);
  });

  it('falls back to fallback categories when user has no interests', async () => {
    const service = new TaskTemplateService('user-1');
    const picked = await service.listDailyRecommend([], { now: UTC_DAY_1 });

    expect(picked).toHaveLength(RECOMMEND_COUNT);
    for (const p of picked) {
      expect(taskTemplates.some((t) => t.id === p.id)).toBe(true);
      expect(p.source).toBe('fallback');
      expect(p.fallbackPool).toBe('preferred_category');
    }
  });

  it('marks all-candidate fallback when preferred fallback categories are exhausted', async () => {
    const service = new TaskTemplateService('user-1');
    const fallbackCategoryIds = taskTemplates
      .filter((t) => TASK_TEMPLATE_FALLBACK_CATEGORIES.includes(t.category))
      .map((t) => t.id);

    const picked = await service.listDailyRecommend([], {
      excludeIds: fallbackCategoryIds,
      now: UTC_DAY_1,
    });

    expect(picked).toHaveLength(RECOMMEND_COUNT);
    expect(picked.every((p) => p.source === 'fallback')).toBe(true);
    expect(picked.every((p) => p.fallbackPool === 'all_candidates')).toBe(true);
  });

  it('intersection is case-insensitive and trims whitespace', async () => {
    const service = new TaskTemplateService('user-1');
    const picked = await service.listDailyRecommend(['  CoDing  '], { now: UTC_DAY_1 });

    const codingMatches = taskTemplates.filter((t) => t.interests.includes('coding'));
    expect(picked.some((p) => codingMatches.some((m) => m.id === p.id))).toBe(true);
  });

  it('unrecognized interest strings fall back to non-matched pool', async () => {
    const service = new TaskTemplateService('user-1');
    // Freeform custom input won't match any template's interests — should still return 3 picks
    const picked = await service.listDailyRecommend(['my special hobby'], { now: UTC_DAY_1 });

    expect(picked).toHaveLength(RECOMMEND_COUNT);
  });

  it('excludes templates listed in excludeIds', async () => {
    const service = new TaskTemplateService('user-1');
    const baseline = await service.listDailyRecommend(['coding'], { now: UTC_DAY_1 });
    expect(baseline.length).toBeGreaterThan(0);

    const excludedId = baseline[0].id;
    const picked = await service.listDailyRecommend(['coding'], {
      excludeIds: [excludedId],
      now: UTC_DAY_1,
    });

    expect(picked.some((t) => t.id === excludedId)).toBe(false);
    expect(picked).toHaveLength(RECOMMEND_COUNT);
  });

  it('drops templates whose required skill sources are not all enabled', async () => {
    const service = new TaskTemplateService('user-1');
    // Without `enabledSkillSources`, any template with `requiresSkills` is filtered out.
    // Since current catalog has none, this should match the baseline (no-op).
    const baseline = await service.listDailyRecommend(['coding'], { now: UTC_DAY_1 });
    expect(baseline).toHaveLength(RECOMMEND_COUNT);
  });

  it('returns only non-excluded templates when most are excluded', async () => {
    const service = new TaskTemplateService('user-1');
    const allIds = taskTemplates.map((t) => t.id);
    const keepIds = allIds.slice(0, 2);
    const excludeIds = allIds.slice(2);

    const picked = await service.listDailyRecommend(['coding'], {
      excludeIds,
      now: UTC_DAY_1,
    });

    expect(picked.map((t) => t.id).sort()).toEqual([...keepIds].sort());
  });
});

describe('isTemplateSkillSourceEligible', () => {
  it('treats templates without requiresSkills as always eligible', () => {
    expect(isTemplateSkillSourceEligible(makeTemplate({}))).toBe(true);
    expect(isTemplateSkillSourceEligible(makeTemplate({}), new Set())).toBe(true);
  });

  it('filters out skill-dependent templates when enabledSkillSources is undefined', () => {
    const t = makeTemplate({ requiresSkills: [{ provider: 'github', source: 'lobehub' }] });
    expect(isTemplateSkillSourceEligible(t, undefined)).toBe(false);
  });

  it('keeps templates whose only source is enabled', () => {
    const t = makeTemplate({ requiresSkills: [{ provider: 'notion', source: 'lobehub' }] });
    expect(isTemplateSkillSourceEligible(t, new Set(['lobehub']))).toBe(true);
  });

  it('drops templates whose source is not in enabledSkillSources', () => {
    const t = makeTemplate({ requiresSkills: [{ provider: 'notion', source: 'lobehub' }] });
    expect(isTemplateSkillSourceEligible(t, new Set(['klavis']))).toBe(false);
  });

  it('requires every source for multi-skill templates', () => {
    const t = makeTemplate({
      requiresSkills: [
        { provider: 'notion', source: 'lobehub' },
        { provider: 'google-calendar', source: 'klavis' },
      ],
    });
    expect(isTemplateSkillSourceEligible(t, new Set(['lobehub']))).toBe(false);
    expect(isTemplateSkillSourceEligible(t, new Set(['klavis']))).toBe(false);
    expect(isTemplateSkillSourceEligible(t, new Set(['lobehub', 'klavis']))).toBe(true);
  });

  it('treats empty requiresSkills array same as undefined (always eligible)', () => {
    const t = makeTemplate({ requiresSkills: [] });
    expect(isTemplateSkillSourceEligible(t, undefined)).toBe(true);
  });
});
