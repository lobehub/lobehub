// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agents,
  expertiseBindings,
  expertiseDomains,
  expertiseDomainSnapshots,
  expertiseHits,
  expertiseInsights,
  expertiseLessons,
  expertiseRuns,
  topics,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ExpertiseModel } from '../expertise';
import { createProxyTestDB } from './_proxyTestDB';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'expertise-guards-user';
const otherUserId = 'expertise-guards-other';
const domainId = 'expertise-guards-domain';
const foreignDomainId = 'expertise-guards-foreign-domain';

const model = () => new ExpertiseModel(serverDB, userId);

const seedDomain = async (
  id: string,
  overrides: Partial<typeof expertiseDomains.$inferInsert> = {},
) => {
  await serverDB.insert(expertiseDomains).values({
    anchorChosenAt: new Date(),
    domainFilter: `${id} filter`,
    id,
    slug: id,
    title: `${id} title`,
    userId,
    ...overrides,
  });
};

const seedRun = async (
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
  code: string,
  overrides: Partial<typeof expertiseLessons.$inferInsert> = {},
) => {
  const [lesson] = await serverDB
    .insert(expertiseLessons)
    .values({
      code,
      domainId,
      polarity: 'rule',
      sections: [{ body: code, key: 'rule' }],
      title: code,
      ...overrides,
    })
    .returning();
  return lesson;
};

const cleanup = async () => {
  // Domains, runs, lessons, hits, snapshots, insights and agents all cascade from the users.
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(cleanup);

describe('ExpertiseModel read guards', () => {
  it('answers an empty domain list without querying', async () => {
    const m = model();

    expect(await m.latestSnapshots([])).toEqual([]);
    expect(await m.seriesForDomains([])).toEqual([]);
    expect(await m.reliabilitySeries([])).toEqual([]);
    expect(await m.listLessonsWithRecent([])).toEqual([]);
    expect(await m.actorsByDomain([])).toEqual([]);
    expect(await m.listInsights([])).toEqual([]);
  });

  it('lists nothing for an agent the caller cannot see', async () => {
    await serverDB
      .insert(agents)
      .values({ id: 'expertise-guards-foreign-agent', userId: otherUserId });

    expect(await model().listDomainsForAgent('expertise-guards-foreign-agent')).toEqual([]);
    expect(await model().listDomainsForAgent('expertise-guards-missing-agent')).toEqual([]);
  });

  it('resolves agent, project and always-on domains', async () => {
    await serverDB.insert(agents).values({ id: 'expertise-guards-agent', userId });
    await seedDomain(domainId);
    await seedDomain('expertise-guards-agent-domain');
    await serverDB.insert(expertiseBindings).values([
      { boundUserId: userId, domainId },
      { agentId: 'expertise-guards-agent', domainId: 'expertise-guards-agent-domain' },
    ]);

    const forAgent = await model().listDomainsForAgent('expertise-guards-agent');
    const forProject = await model().listDomainsForProject('expertise-guards-missing-project');

    expect(forAgent.map(({ domain }) => domain.id).sort()).toEqual(
      ['expertise-guards-agent-domain', domainId].sort(),
    );
    expect(forProject.map(({ domain }) => domain.id)).toEqual([domainId]);
  });

  it('reads the latest snapshot, the series and the human flags of a domain', async () => {
    await seedDomain(domainId);
    const first = await seedRun(1, { hadHumanInLoop: true });
    const second = await seedRun(2);
    await serverDB.insert(expertiseDomainSnapshots).values([
      { activeCount: 1, domainId, learnedTotal: 1, runId: first.id, runIndex: 1 },
      { activeCount: 3, domainId, learnedTotal: 3, runId: second.id, runIndex: 2 },
    ]);

    const m = model();
    const [latest] = await m.latestSnapshots([domainId]);
    const series = await m.seriesForDomains([domainId]);
    const snapshots = await m.listSnapshots(domainId);
    const runs = await m.listRuns(domainId, 1);
    const flags = await m.runHumanFlags(domainId);

    expect(latest).toMatchObject({ activeCount: 3, runIndex: 2 });
    expect(series).toEqual([
      { activeCount: 1, domainId, runIndex: 1 },
      { activeCount: 3, domainId, runIndex: 2 },
    ]);
    expect(snapshots.map(({ runIndex }) => runIndex)).toEqual([1, 2]);
    expect(runs.map(({ runIndex }) => runIndex)).toEqual([2]);
    expect(await m.countRuns(domainId)).toBe(2);
    expect(flags).toEqual([
      { hadHumanInLoop: true, runIndex: 1 },
      { hadHumanInLoop: false, runIndex: 2 },
    ]);
  });

  it('counts runs and lessons of an empty domain as zero', async () => {
    await seedDomain(domainId);

    expect(await model().countRuns(domainId)).toBe(0);
    expect(await model().lessonStats(domainId)).toEqual({ hits: 0, total: 0, unused: 0 });
  });

  it('falls back to zero when an aggregate returns no row', async () => {
    await seedDomain(domainId);
    await seedRun(1);
    await seedLesson('P-01', { hitCount: 2 });
    // An aggregate without GROUP BY always yields one row in Postgres; the fallbacks guard a
    // driver that drops it, so the seam strips the rows of the aggregate queries only.
    const db = createProxyTestDB(serverDB, (query, result) =>
      /count\(\*\)/.test(query) ? [] : result.rows,
    );
    const m = new ExpertiseModel(db, userId);

    expect(await m.countRuns(domainId)).toBe(0);
    expect(await m.lessonStats(domainId)).toEqual({ hits: 0, total: 0, unused: 0 });
  });

  it('summarizes active lessons and leaves out retired ones', async () => {
    await seedDomain(domainId);
    await seedLesson('P-01', { hitCount: 3 });
    await seedLesson('P-02', { hitCount: 0 });
    await seedLesson('P-03', { hitCount: 9, status: 'retired' });

    expect(await model().lessonStats(domainId)).toEqual({ hits: 3, total: 2, unused: 1 });
  });

  it('ranks lessons into tiers and filters them by layer and title', async () => {
    await seedDomain(domainId);
    await seedLesson('P-01', { hitCount: 10, layer: 'craft', title: 'Use tokens for colour' });
    await seedLesson('P-02', { hitCount: 1, layer: 'craft', title: 'Name the colour scale' });
    await seedLesson('P-03', { hitCount: 0, layer: 'taste', title: 'Prefer calm motion' });

    const all = await model().listLessons(domainId);
    const craft = await model().listLessons(domainId, { layer: 'craft' });
    const searched = await model().listLessons(domainId, { search: 'colour' });

    expect(all.map(({ code, tier }) => [code, tier])).toEqual([
      ['P-01', 'core'],
      ['P-02', 'niche'],
      ['P-03', 'unused'],
    ]);
    expect(craft.map(({ code }) => code)).toEqual(['P-01', 'P-02']);
    expect(searched.map(({ code }) => code)).toEqual(['P-01', 'P-02']);
  });

  it('does not list the lessons of another user domain', async () => {
    await seedDomain(foreignDomainId, { userId: otherUserId });
    await seedLesson('P-01', { domainId: foreignDomainId });

    expect(await model().listLessons(foreignDomainId)).toEqual([]);
  });

  it('counts lessons by layer and by canon anchor, unanchored ones apart', async () => {
    await seedDomain(domainId);
    await seedLesson('P-01', { canonAnchor: 'contrast', layer: 'craft' });
    await seedLesson('P-02', { canonAnchor: 'contrast', layer: 'craft' });
    await seedLesson('P-03');

    expect(await model().layerCounts(domainId)).toEqual({ craft: 2 });
    expect(await model().canonAnchorCounts(domainId)).toEqual({
      byKey: { contrast: 2 },
      unanchored: 1,
    });
  });

  it('reports no unanchored lessons when every lesson has an anchor', async () => {
    await seedDomain(domainId);
    await seedLesson('P-01', { canonAnchor: 'contrast' });

    expect(await model().canonAnchorCounts(domainId)).toEqual({
      byKey: { contrast: 1 },
      unanchored: 0,
    });
  });

  it('lists recent outcomes per lesson, newest last, with the topic they happened in', async () => {
    await seedDomain(domainId);
    await serverDB
      .insert(topics)
      .values({ id: 'expertise-guards-topic', title: 'Release checklist', userId });
    const run1 = await seedRun(1, { subjectId: 'expertise-guards-topic' });
    const run2 = await seedRun(2, {
      subjectId: 'expertise-guards-standalone',
      subjectType: 'standalone',
    });
    const run3 = await seedRun(3, { reflectionKey: 'material:document:doc-1' });
    const hit = await seedLesson('P-01', { hitCount: 2 });
    const quiet = await seedLesson('P-02', { createdByUserId: userId });
    await serverDB.insert(expertiseHits).values([
      { domainId, lessonId: hit.id, outcome: 'violation', runId: run1.id },
      { domainId, lessonId: hit.id, outcome: 'pass', runId: run2.id },
      // A material quote is not practice and stays out of the recent outcomes.
      { domainId, lessonId: hit.id, outcome: 'pass', runId: run3.id },
    ]);

    const rows = await model().listLessonsWithRecent([domainId], 1);
    const full = await model().listLessonsWithRecent([domainId]);

    expect(rows.find(({ id }) => id === hit.id)?.recent).toEqual([
      {
        pass: true,
        runIndex: 2,
        subjectId: 'expertise-guards-standalone',
        subjectTitle: null,
        subjectType: 'standalone',
      },
    ]);
    expect(
      full
        .find(({ id }) => id === hit.id)
        ?.recent.map(({ pass, subjectTitle }) => [pass, subjectTitle]),
    ).toEqual([
      [false, 'Release checklist'],
      [true, null],
    ]);
    expect(full.find(({ id }) => id === quiet.id)).toMatchObject({
      recent: [],
      taughtByUser: true,
    });
    expect(full.find(({ id }) => id === hit.id)?.taughtByUser).toBe(false);
  });

  it('builds the reliability series and the agents that practised a domain', async () => {
    await seedDomain(domainId);
    const run1 = await seedRun(1, { actorId: 'agent-a' });
    const run2 = await seedRun(2, { actorId: userId, actorType: 'user' });
    const lesson = await seedLesson('P-01');
    await serverDB.insert(expertiseHits).values([
      { domainId, lessonId: lesson.id, outcome: 'violation', runId: run1.id },
      { domainId, lessonId: lesson.id, outcome: 'pass', runId: run1.id },
      { domainId, lessonId: lesson.id, outcome: 'pass', runId: run2.id },
    ]);

    expect(await model().reliabilitySeries([domainId])).toEqual([
      { domainId, pass: 1, runIndex: 1, violation: 1 },
      { domainId, pass: 1, runIndex: 2, violation: 0 },
    ]);
    expect(await model().actorsByDomain([domainId])).toEqual([{ actorId: 'agent-a', domainId }]);
  });

  it('lists the evidence of a lesson, titled by its topic or else its subject', async () => {
    await seedDomain(domainId);
    await serverDB
      .insert(topics)
      .values({ id: 'expertise-guards-topic', title: 'Release checklist', userId });
    const run1 = await seedRun(1, { subjectId: 'expertise-guards-topic' });
    const run2 = await seedRun(2, { subjectId: 'doc-7', subjectType: 'document' });
    const lesson = await seedLesson('P-01');
    await serverDB.insert(expertiseHits).values([
      {
        createdAt: new Date('2026-01-01T00:00:00Z'),
        domainId,
        lessonId: lesson.id,
        outcome: 'violation',
        runId: run1.id,
      },
      {
        createdAt: new Date('2026-01-02T00:00:00Z'),
        domainId,
        lessonId: lesson.id,
        outcome: 'pass',
        runId: run2.id,
      },
    ]);

    const hits = await model().listLessonHits(lesson.id);
    const limited = await model().listLessonHits(lesson.id, 1);
    const foreign = await new ExpertiseModel(serverDB, otherUserId).listLessonHits(lesson.id);

    expect(hits.map(({ runTitle }) => runTitle)).toEqual(['doc-7', 'Release checklist']);
    expect(limited).toHaveLength(1);
    expect(foreign).toEqual([]);
  });

  it('lists active insights in scope, including ones without a domain, and dismisses one', async () => {
    await seedDomain(domainId);
    const [scoped, unscoped, dismissed, foreign] = await serverDB
      .insert(expertiseInsights)
      .values([
        {
          body: 'b',
          confidence: 0.9,
          domainId,
          headline: 'scoped',
          kind: 'repeated-mistake',
          userId,
        },
        { body: 'b', confidence: 0.5, headline: 'unscoped', kind: 'repeated-mistake', userId },
        {
          body: 'b',
          domainId,
          headline: 'dismissed',
          kind: 'repeated-mistake',
          status: 'dismissed',
          userId,
        },
        { body: 'b', headline: 'foreign', kind: 'repeated-mistake', userId: otherUserId },
      ])
      .returning();

    const listed = await model().listInsights([domainId]);
    await model().dismissInsight(scoped.id);
    await model().dismissInsight(foreign.id, 'not mine');
    const after = await serverDB
      .select({ id: expertiseInsights.id, status: expertiseInsights.status })
      .from(expertiseInsights)
      .where(inArray(expertiseInsights.id, [scoped.id, foreign.id]));

    expect(listed.map(({ id }) => id)).toEqual([scoped.id, unscoped.id]);
    expect(dismissed.status).toBe('dismissed');
    expect(Object.fromEntries(after.map(({ id, status }) => [id, status]))).toEqual({
      [foreign.id]: 'active',
      [scoped.id]: 'dismissed',
    });
  });

  it('keeps only the first binding of a domain mounted at several levels', async () => {
    await serverDB.insert(agents).values({ id: 'expertise-guards-agent', userId });
    await seedDomain(domainId);
    await serverDB.insert(expertiseBindings).values([
      { boundUserId: userId, domainId, sortOrder: 1 },
      { agentId: 'expertise-guards-agent', domainId, sortOrder: 0 },
    ]);

    const rows = await model().listDomainsForAgent('expertise-guards-agent');
    const [binding] = await serverDB
      .select({ id: expertiseBindings.id })
      .from(expertiseBindings)
      .where(eq(expertiseBindings.agentId, 'expertise-guards-agent'));

    expect(rows).toHaveLength(1);
    expect(rows[0].binding.id).toBe(binding.id);
  });
});
