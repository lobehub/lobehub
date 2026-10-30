// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agents,
  expertiseBindings,
  expertiseDomains,
  expertiseHits,
  expertiseLessons,
  expertiseRuns,
  projects,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ExpertiseModel } from '../expertise';
import { createProxyTestDB } from './_proxyTestDB';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'expertise-lineage-user';
const otherUserId = 'expertise-lineage-other';
const workspaceId = 'expertise-lineage-workspace';
const domainId = 'expertise-lineage-domain';
const foreignDomainId = 'expertise-lineage-foreign-domain';

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

const cleanup = async () => {
  // Workspaces, projects, agents and every expertise row cascade from the users.
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(cleanup);

describe('ExpertiseModel lineage', () => {
  it('reads no sources and no runs for a rule outside the caller scope', async () => {
    await seedDomain(foreignDomainId, { userId: otherUserId });
    const foreign = await seedLesson('P-01', { domainId: foreignDomainId });

    expect(await model().listLessonSources(foreign.id)).toEqual([]);
    expect(await model().countLineageRuns(foreign.id)).toBe(0);
  });

  it('follows merges and moves through a cycle and past a parent out of scope', async () => {
    await seedDomain(domainId);
    await seedDomain(foreignDomainId, { userId: otherUserId });
    const outOfScope = await seedLesson('P-01', { domainId: foreignDomainId });
    const a = await seedLesson('P-01');
    const b = await seedLesson('P-02', { generalizedFromIds: [a.id, outOfScope.id] });
    const root = await seedLesson('P-03', { generalizedFromIds: [b.id], salvagedFromId: a.id });
    // A malformed lineage that points back at the root must still terminate.
    await serverDB
      .update(expertiseLessons)
      .set({ salvagedFromId: root.id })
      .where(inArray(expertiseLessons.id, [a.id]));
    const run1 = await seedRun(1);
    const run2 = await seedRun(2);
    await serverDB.insert(expertiseHits).values([
      { domainId, lessonId: a.id, outcome: 'violation', runId: run1.id },
      { domainId, lessonId: b.id, outcome: 'violation', runId: run1.id },
      { domainId, lessonId: root.id, outcome: 'violation', runId: run2.id },
    ]);

    const sources = await model().listLessonSources(root.id);

    expect(sources).toHaveLength(3);
    expect(await model().countLineageRuns(root.id)).toBe(2);
    expect(await model().countLineageRuns(b.id)).toBe(2);
  });

  it('counts lineage runs as zero when the aggregate returns no row', async () => {
    await seedDomain(domainId);
    const lesson = await seedLesson('P-01');
    // A `count(distinct …)` without GROUP BY always yields a row; the seam drops it to reach the
    // fallback a driver returning nothing would take.
    const db = createProxyTestDB(serverDB, (query, result) =>
      /count\(distinct/.test(query) ? [] : result.rows,
    );

    expect(await new ExpertiseModel(db, userId).countLineageRuns(lesson.id)).toBe(0);
  });
});

describe('ExpertiseModel rule listing', () => {
  it('lists nothing when the caller has no groups', async () => {
    expect(await model().listRules()).toEqual([]);
  });

  it('lists an empty group with no rules and its reviewer scope', async () => {
    await seedDomain(domainId);
    await serverDB.insert(expertiseBindings).values({ boundUserId: userId, domainId });

    expect(await model().listRules()).toEqual([
      {
        domain: {
          domainFilter: `${domainId} filter`,
          id: domainId,
          outOfScope: null,
          title: `${domainId} title`,
        },
        owner: { kind: 'mine' },
        rules: [],
        scopes: [{ id: userId, kind: 'user', title: null }],
      },
    ]);
  });

  it('names every scope a group reaches and counts a rule without hits as zero', async () => {
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'Workspace',
      primaryOwnerId: userId,
      slug: 'expertise-lineage-ws',
    });
    await serverDB
      .insert(agents)
      .values({ id: 'expertise-lineage-agent', title: 'Scout', userId, workspaceId });
    await serverDB
      .insert(projects)
      .values({ id: 'expertise-lineage-project', name: 'Launch', userId, workspaceId });
    await seedDomain(domainId, { workspaceId });
    await serverDB.insert(expertiseBindings).values([
      { boundWorkspaceId: workspaceId, domainId, sortOrder: 0 },
      { domainId, projectId: 'expertise-lineage-project', sortOrder: 1 },
      { agentId: 'expertise-lineage-agent', domainId, sortOrder: 2 },
    ]);
    const lesson = await seedLesson('P-01', { createdByUserId: userId });

    const [group] = await new ExpertiseModel(serverDB, userId, workspaceId).listRules();

    expect(group.owner).toEqual({ kind: 'mine' });
    expect(group.scopes).toEqual([
      { id: workspaceId, kind: 'workspace', title: null },
      { id: 'expertise-lineage-project', kind: 'project', title: 'Launch' },
      { id: 'expertise-lineage-agent', kind: 'agent', title: 'Scout' },
    ]);
    expect(group.rules).toEqual([
      expect.objectContaining({
        authored: true,
        conversationHitCount: 0,
        id: lesson.id,
        materialHitCount: 0,
        rejectionHitCount: 0,
      }),
    ]);
  });

  it("orders agents' groups by agent after the reviewer's, and drops a group only an invisible agent holds", async () => {
    await serverDB.insert(agents).values([
      { id: 'expertise-lineage-agent-a', title: 'A', userId },
      { id: 'expertise-lineage-agent-b', title: 'B', userId },
      { id: 'expertise-lineage-foreign-agent', userId: otherUserId },
    ]);
    for (const id of ['d-a1', 'd-b', 'd-a2', 'd-mine', 'd-hidden'])
      await seedDomain(`expertise-lineage-${id}`);
    await serverDB.insert(expertiseBindings).values([
      { agentId: 'expertise-lineage-agent-a', domainId: 'expertise-lineage-d-a1', sortOrder: 0 },
      { agentId: 'expertise-lineage-agent-b', domainId: 'expertise-lineage-d-b', sortOrder: 1 },
      { agentId: 'expertise-lineage-agent-a', domainId: 'expertise-lineage-d-a2', sortOrder: 2 },
      { boundUserId: userId, domainId: 'expertise-lineage-d-mine', sortOrder: 3 },
      {
        agentId: 'expertise-lineage-foreign-agent',
        domainId: 'expertise-lineage-d-hidden',
        sortOrder: 4,
      },
    ]);

    const groups = await model().listRules();

    expect(
      groups.map(({ domain, owner }) => [
        domain.id,
        owner.kind === 'agent' ? owner.agent.id : 'mine',
      ]),
    ).toEqual([
      ['expertise-lineage-d-mine', 'mine'],
      ['expertise-lineage-d-a1', 'expertise-lineage-agent-a'],
      ['expertise-lineage-d-a2', 'expertise-lineage-agent-a'],
      ['expertise-lineage-d-b', 'expertise-lineage-agent-b'],
    ]);
  });

  it('counts the undistilled backlog as zero when the aggregate returns no row', async () => {
    const db = createProxyTestDB(serverDB, (query, result) =>
      /count\(distinct/.test(query) ? [] : result.rows,
    );

    expect(await new ExpertiseModel(db, userId).countUndistilledRejectionRounds()).toBe(0);
    expect(await model().countUndistilledRejectionRounds()).toBe(0);
  });
});
