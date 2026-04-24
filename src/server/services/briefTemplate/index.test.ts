// @vitest-environment node
import { briefTemplates } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { BriefTemplateService, RECOMMEND_COUNT } from './index';

const UTC_DAY_1 = new Date('2026-04-24T10:00:00Z');
const UTC_DAY_2 = new Date('2026-04-25T10:00:00Z');

describe('BriefTemplateService.listDailyRecommend', () => {
  const db = {} as LobeChatDatabase;

  it('returns RECOMMEND_COUNT items when user has matching interests', async () => {
    const service = new BriefTemplateService(db, 'user-1');
    const picked = await service.listDailyRecommend(['coding'], UTC_DAY_1);

    expect(picked).toHaveLength(RECOMMEND_COUNT);
    const codingMatches = briefTemplates.filter((t) => t.interests.includes('coding'));
    expect(picked.some((p) => codingMatches.some((m) => m.id === p.id))).toBe(true);
  });

  it('is stable for the same (userId, utcDate)', async () => {
    const service = new BriefTemplateService(db, 'user-1');

    const a = await service.listDailyRecommend(['coding'], UTC_DAY_1);
    const b = await service.listDailyRecommend(
      ['coding'],
      new Date('2026-04-24T23:59:00Z'), // still same UTC day
    );

    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id));
  });

  it('changes across UTC days', async () => {
    let matches = 0;
    for (const suffix of ['a', 'b', 'c', 'd', 'e']) {
      const service = new BriefTemplateService(db, `user-${suffix}`);
      const d1 = await service.listDailyRecommend([], UTC_DAY_1);
      const d2 = await service.listDailyRecommend([], UTC_DAY_2);
      if (JSON.stringify(d1) === JSON.stringify(d2)) matches += 1;
    }
    expect(matches).toBeLessThan(5);
  });

  it('differs across users on the same day', async () => {
    const results = await Promise.all(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((s) =>
        new BriefTemplateService(db, `user-${s}`)
          .listDailyRecommend([], UTC_DAY_1)
          .then((r) => r.map((t) => t.id).join(',')),
      ),
    );
    expect(new Set(results).size).toBeGreaterThan(1);
  });

  it('falls back to fallback categories when user has no interests', async () => {
    const service = new BriefTemplateService(db, 'user-1');
    const picked = await service.listDailyRecommend([], UTC_DAY_1);

    expect(picked).toHaveLength(RECOMMEND_COUNT);
    for (const p of picked) {
      expect(briefTemplates.some((t) => t.id === p.id)).toBe(true);
    }
  });

  it('intersection is case-insensitive and trims whitespace', async () => {
    const service = new BriefTemplateService(db, 'user-1');
    const picked = await service.listDailyRecommend(['  CoDing  '], UTC_DAY_1);

    const codingMatches = briefTemplates.filter((t) => t.interests.includes('coding'));
    expect(picked.some((p) => codingMatches.some((m) => m.id === p.id))).toBe(true);
  });

  it('unrecognized interest strings fall back to non-matched pool', async () => {
    const service = new BriefTemplateService(db, 'user-1');
    // Freeform custom input won't match any template's interests — should still return 3 picks
    const picked = await service.listDailyRecommend(['my special hobby'], UTC_DAY_1);

    expect(picked).toHaveLength(RECOMMEND_COUNT);
  });
});
