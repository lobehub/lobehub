// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  expertiseDomains,
  expertiseDomainSnapshots,
  expertiseLessons,
  expertiseRuns,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ExpertiseModel } from '../expertise';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'expertise-rollup-user';
const otherUserId = 'expertise-rollup-other';

const domainA = 'expertise-rollup-domain-a';
const domainB = 'expertise-rollup-domain-b';

const model = () => new ExpertiseModel(serverDB, userId);

const seedDomain = async (id: string, owner = userId, slug = id) => {
  await serverDB
    .insert(expertiseDomains)
    .values({ domainFilter: `${slug} filter`, id, slug, title: `${slug} title`, userId: owner });
};

const seedRun = async (
  domainId: string,
  runIndex: number,
  overrides: Partial<typeof expertiseRuns.$inferInsert> = {},
) => {
  const [run] = await serverDB
    .insert(expertiseRuns)
    .values({
      actorId: 'agent-1',
      actorType: 'agent',
      domainId,
      runIndex,
      subjectId: `topic-${runIndex}`,
      subjectType: 'topic',
      userId,
      ...overrides,
    })
    .returning();
  return run;
};

const seedLesson = async (
  domainId: string,
  overrides: Partial<typeof expertiseLessons.$inferInsert> & { code: string },
) => {
  const [lesson] = await serverDB
    .insert(expertiseLessons)
    .values({ domainId, polarity: 'rule', sections: [], title: overrides.code, ...overrides })
    .returning();
  return lesson;
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await seedDomain(domainA);
  await seedDomain(domainB);
});

describe('ExpertiseModel.latestSnapshots', () => {
  it('keeps only the highest run of each domain', async () => {
    await serverDB.insert(expertiseDomainSnapshots).values([
      { activeCount: 1, domainId: domainA, learnedTotal: 1, runIndex: 1 },
      { activeCount: 5, domainId: domainA, learnedTotal: 5, runIndex: 2 },
      { activeCount: 3, domainId: domainB, learnedTotal: 3, runIndex: 1 },
    ]);

    const snapshots = await model().latestSnapshots([domainA, domainB]);

    expect(snapshots).toHaveLength(2);
    expect(snapshots.find((row) => row.domainId === domainA)?.activeCount).toBe(5);
    expect(snapshots.find((row) => row.domainId === domainB)?.activeCount).toBe(3);
  });

  it('returns nothing for an empty request', async () => {
    await expect(model().latestSnapshots([])).resolves.toEqual([]);
  });

  it('returns the full series in domain then run order', async () => {
    await serverDB.insert(expertiseDomainSnapshots).values([
      { activeCount: 1, domainId: domainB, learnedTotal: 1, runIndex: 2 },
      { activeCount: 1, domainId: domainA, learnedTotal: 1, runIndex: 2 },
      { activeCount: 1, domainId: domainA, learnedTotal: 1, runIndex: 1 },
    ]);

    const series = await model().seriesForDomains([domainA, domainB]);

    expect(series.map((row) => [row.domainId, row.runIndex])).toEqual([
      [domainA, 1],
      [domainA, 2],
      [domainB, 2],
    ]);
    await expect(model().seriesForDomains([])).resolves.toEqual([]);
  });
});

describe('ExpertiseModel domain detail reads', () => {
  it('lists one domain’s snapshot series and newest runs first', async () => {
    await serverDB.insert(expertiseDomainSnapshots).values([
      { activeCount: 1, domainId: domainA, learnedTotal: 1, runIndex: 2 },
      { activeCount: 1, domainId: domainA, learnedTotal: 1, runIndex: 1 },
      { activeCount: 9, domainId: domainB, learnedTotal: 9, runIndex: 1 },
    ]);
    await seedRun(domainA, 1);
    await seedRun(domainA, 2);
    await seedRun(domainA, 3);

    const snapshots = await model().listSnapshots(domainA);
    const runs = await model().listRuns(domainA, 2);

    expect(snapshots.map((row) => row.runIndex)).toEqual([1, 2]);
    expect(runs.map((row) => row.runIndex)).toEqual([3, 2]);
  });

  it('counts every run, independently of the page limit', async () => {
    await seedRun(domainA, 1);
    await seedRun(domainA, 2);
    await seedRun(domainB, 1);

    await expect(model().countRuns(domainA)).resolves.toBe(2);
    await expect(model().countRuns('expertise-rollup-domain-none')).resolves.toBe(0);
  });

  it('reports human participation per run in run order', async () => {
    await seedRun(domainA, 2, { hadHumanInLoop: true });
    await seedRun(domainA, 1);

    const flags = await model().runHumanFlags(domainA);

    expect(flags).toEqual([
      { hadHumanInLoop: false, runIndex: 1 },
      { hadHumanInLoop: true, runIndex: 2 },
    ]);
  });

  it('lists the agents that practised each domain, skipping human actors', async () => {
    await seedRun(domainA, 1, { actorId: 'agent-1' });
    await seedRun(domainA, 2, { actorId: 'agent-1' });
    await seedRun(domainA, 3, { actorId: 'user-actor', actorType: 'user' });
    await seedRun(domainB, 1, { actorId: 'agent-2' });

    const actors = await model().actorsByDomain([domainA, domainB]);

    expect(actors).toHaveLength(2);
    expect(actors).toEqual(
      expect.arrayContaining([
        { actorId: 'agent-1', domainId: domainA },
        { actorId: 'agent-2', domainId: domainB },
      ]),
    );
    await expect(model().actorsByDomain([])).resolves.toEqual([]);
  });

  it('summarizes active lessons only', async () => {
    await seedLesson(domainA, { code: 'L-1', hitCount: 3 });
    await seedLesson(domainA, { code: 'L-2' });
    await seedLesson(domainA, { code: 'L-3', hitCount: 100, status: 'rejected' });

    await expect(model().lessonStats(domainA)).resolves.toEqual({ hits: 3, total: 2, unused: 1 });
  });
});

describe('ExpertiseModel lesson library reads', () => {
  const tiers: Record<string, number> = { 'L-core': 10, 'L-tied': 4, 'L-niche': 3, 'L-unused': 0 };

  beforeEach(async () => {
    for (const [code, hitCount] of Object.entries(tiers)) {
      await seedLesson(domainA, { code, hitCount, layer: code === 'L-niche' ? 'L2' : 'L1' });
    }
  });

  it('assigns core / niche / unused tiers from the domain’s hit distribution', async () => {
    const lessons = await model().listLessons(domainA);

    expect(Object.fromEntries(lessons.map((row) => [row.code, row.tier]))).toEqual({
      'L-core': 'core',
      'L-niche': 'niche',
      'L-tied': 'core',
      'L-unused': 'unused',
    });
  });

  it('filters by layer and by a case-insensitive title search', async () => {
    const byLayer = await model().listLessons(domainA, { layer: 'L2' });
    await seedLesson(domainA, { code: 'L-cache', hitCount: 1, title: 'Cache the PAT' });
    const bySearch = await model().listLessons(domainA, { search: 'pat' });

    expect(byLayer.map((row) => row.code)).toEqual(['L-niche']);
    expect(bySearch.map((row) => row.code)).toEqual(['L-cache']);
  });

  it('counts lessons per declared layer, ignoring unlayered ones', async () => {
    await seedLesson(domainA, { code: 'L-null', hitCount: 1 });

    await expect(model().layerCounts(domainA)).resolves.toEqual({ L1: 3, L2: 1 });
  });

  it('counts lessons per canon anchor and reports the unanchored bucket', async () => {
    await seedLesson(domainA, { canonAnchor: 'rule:cache', code: 'L-anchored-1', hitCount: 1 });
    await seedLesson(domainA, { canonAnchor: 'rule:cache', code: 'L-anchored-2', hitCount: 1 });

    const counts = await model().canonAnchorCounts(domainA);

    expect(counts.byKey).toEqual({ 'rule:cache': 2 });
    expect(counts.unanchored).toBe(4);
  });
});

describe('ExpertiseModel domain scoping', () => {
  it('never reads the lesson library of another owner’s domain', async () => {
    await seedDomain('expertise-rollup-domain-theirs', otherUserId);
    await seedLesson('expertise-rollup-domain-theirs', { code: 'L-theirs', hitCount: 3 });

    await expect(model().listLessons('expertise-rollup-domain-theirs')).resolves.toEqual([]);
  });
});
