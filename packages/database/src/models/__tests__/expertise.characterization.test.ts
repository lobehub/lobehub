// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agents,
  expertiseBindings,
  expertiseDomains,
  expertiseHits,
  expertiseLessonRevisions,
  expertiseLessons,
  expertiseRuns,
  projects,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ExpertiseModel } from '../expertise';

/**
 * Pins the public methods of `ExpertiseModel` that `expertise.test.ts` does not call directly,
 * so moving their bodies into sibling modules cannot silently rewire one to another.
 */

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'expertise-characterization-user';
const foreignUserId = 'expertise-characterization-foreign';
const runA = '0b6f2a1e-6f0c-4c43-8a54-6c0b2d9f6a01';
const runB = '0b6f2a1e-6f0c-4c43-8a54-6c0b2d9f6a02';
const lockForeignLesson = '0b6f2a1e-6f0c-4c43-8a54-6c0b2d9f6b01';
const lockLesson = '0b6f2a1e-6f0c-4c43-8a54-6c0b2d9f6b02';
const materialLesson = '0b6f2a1e-6f0c-4c43-8a54-6c0b2d9f6b03';
const missingLesson = '0b6f2a1e-6f0c-4c43-8a54-6c0b2d9f6b04';
const retireForeignLesson = '0b6f2a1e-6f0c-4c43-8a54-6c0b2d9f6b05';
const retireLesson = '0b6f2a1e-6f0c-4c43-8a54-6c0b2d9f6b06';
const reviseForeignLesson = '0b6f2a1e-6f0c-4c43-8a54-6c0b2d9f6b07';
const reviseLesson = '0b6f2a1e-6f0c-4c43-8a54-6c0b2d9f6b08';
const runsLesson = '0b6f2a1e-6f0c-4c43-8a54-6c0b2d9f6b09';

const seedDomain = async (id: string, owner = userId, anchored = true) => {
  await serverDB.insert(expertiseDomains).values({
    anchorChosenAt: anchored ? new Date() : null,
    domainFilter: id,
    id,
    slug: id,
    title: id,
    userId: owner,
  });
};

const seedLesson = async (id: string, domainId: string, code = 'P-01') => {
  await serverDB.insert(expertiseLessons).values({
    code,
    domainId,
    id,
    polarity: 'rule',
    sections: [
      { body: 'rule body', key: 'rule' },
      { body: 'old limits', key: 'limits' },
    ],
    title: `lesson ${id}`,
  });
};

const seedRun = async (id: string, domainId: string, runIndex: number) => {
  await serverDB.insert(expertiseRuns).values({
    actorId: 'agent-1',
    actorType: 'agent',
    domainId,
    id,
    runIndex,
    subjectId: `subject-${runIndex}`,
    subjectType: 'standalone',
    userId,
  });
};

describe('ExpertiseModel (characterization)', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: userId }, { id: foreignUserId }]);
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  it('finds only anchored domains in scope', async () => {
    await seedDomain('char-anchored');
    await seedDomain('char-unanchored', userId, false);
    await seedDomain('char-foreign', foreignUserId);
    const model = new ExpertiseModel(serverDB, userId);

    expect((await model.findDomain('char-anchored'))?.id).toBe('char-anchored');
    await expect(model.findDomain('char-unanchored')).resolves.toBeUndefined();
    await expect(model.findDomain('char-foreign')).resolves.toBeUndefined();
  });

  it('resolves owner and project mounts', async () => {
    await serverDB.insert(agents).values({ id: 'char-coordinator', userId });
    await serverDB.insert(projects).values({
      coordinatorAgentId: 'char-coordinator',
      id: 'char-project',
      identifier: 'CHAR',
      name: 'Project',
      userId,
    });
    await seedDomain('char-owner-domain');
    await seedDomain('char-project-domain');
    await serverDB.insert(expertiseBindings).values([
      { boundUserId: userId, domainId: 'char-owner-domain', sortOrder: 0 },
      { domainId: 'char-project-domain', projectId: 'char-project', sortOrder: 1 },
    ]);
    const model = new ExpertiseModel(serverDB, userId);

    const owner = await model.listDomainsForOwner();
    const project = await model.listDomainsForProject('char-project');

    expect(owner.map(({ domain }) => domain.id)).toEqual(['char-owner-domain']);
    expect(project.map(({ domain }) => domain.id)).toEqual([
      'char-owner-domain',
      'char-project-domain',
    ]);
  });

  it('compares the reach of two domains', async () => {
    await serverDB.insert(agents).values({ id: 'char-agent', userId });
    await seedDomain('char-mine');
    await seedDomain('char-agent-domain');
    await seedDomain('char-agent-domain-2');
    await serverDB.insert(expertiseBindings).values([
      { boundUserId: userId, domainId: 'char-mine' },
      { agentId: 'char-agent', domainId: 'char-agent-domain' },
      { agentId: 'char-agent', domainId: 'char-agent-domain-2' },
    ]);
    const model = new ExpertiseModel(serverDB, userId);

    await expect(model.sameReach('char-mine', 'char-mine')).resolves.toBe(true);
    await expect(model.sameReach('char-mine', 'char-agent-domain')).resolves.toBe(false);
    await expect(model.sameReach('char-agent-domain', 'char-agent-domain-2')).resolves.toBe(true);
  });

  it('revises a lesson into a new limits section and records the revision', async () => {
    await seedDomain('char-revise');
    await seedLesson(reviseLesson, 'char-revise');
    await seedDomain('char-revise-foreign', foreignUserId);
    await seedLesson(reviseForeignLesson, 'char-revise-foreign');
    const model = new ExpertiseModel(serverDB, userId);

    await expect(model.reviseLesson(reviseForeignLesson, 'x')).resolves.toBeNull();
    await expect(model.reviseLesson(reviseLesson, '  new limits  ')).resolves.toEqual({
      id: reviseLesson,
      revision: 2,
    });

    const lesson = await model.findLesson(reviseLesson);
    expect(lesson?.currentRevision).toBe(2);
    expect(lesson?.sections).toEqual([
      { body: 'rule body', key: 'rule' },
      { body: 'new limits', key: 'limits' },
    ]);
    const revisions = await model.listLessonRevisions(reviseLesson);
    expect(revisions.map((r) => [r.revision, r.feedback, r.kind, r.byViewer])).toEqual([
      [2, 'new limits', 'user-feedback', true],
    ]);
  });

  it('retires a lesson in scope only', async () => {
    await seedDomain('char-retire');
    await seedLesson(retireLesson, 'char-retire');
    await seedDomain('char-retire-foreign', foreignUserId);
    await seedLesson(retireForeignLesson, 'char-retire-foreign');
    const model = new ExpertiseModel(serverDB, userId);

    await expect(model.retireLesson(retireForeignLesson)).resolves.toBeNull();
    await expect(model.retireLesson(retireLesson)).resolves.toEqual({
      id: retireLesson,
    });
    const lesson = await model.findLesson(retireLesson);
    expect(lesson?.status).toBe('retired');
    expect(lesson?.retiredAt).toBeInstanceOf(Date);
  });

  it('locks a lesson in scope and appends a revision row', async () => {
    await seedDomain('char-lock');
    await seedLesson(lockLesson, 'char-lock');
    await seedDomain('char-lock-foreign', foreignUserId);
    await seedLesson(lockForeignLesson, 'char-lock-foreign');
    const model = new ExpertiseModel(serverDB, userId);

    expect((await model.lockLesson(lockLesson))?.id).toBe(lockLesson);
    await expect(model.lockLesson(lockForeignLesson)).resolves.toBeUndefined();

    await model.insertLessonRevision({
      changedBy: 'user',
      changedByUserId: userId,
      kind: 'user-feedback',
      lessonId: lockLesson,
      prevTitle: 'before',
      revision: 2,
      sections: [],
    });
    const rows = await serverDB
      .select({ prevTitle: expertiseLessonRevisions.prevTitle })
      .from(expertiseLessonRevisions)
      .where(eq(expertiseLessonRevisions.lessonId, lockLesson));
    expect(rows).toEqual([{ prevTitle: 'before' }]);
  });

  it('records a material quote as a passing hit', async () => {
    await seedDomain('char-material');
    await seedLesson(materialLesson, 'char-material');
    const model = new ExpertiseModel(serverDB, userId);
    const run = await model.insertMaterialRun({
      domainId: 'char-material',
      reflectionKey: 'material:document:doc-1',
      subjectId: 'doc-1',
      subjectType: 'document',
    });

    const hitId = await model.insertMaterialHit({
      domainId: 'char-material',
      lessonId: materialLesson,
      quote: '',
      runId: run!,
      where: 'page 2',
    });

    const [hit] = await serverDB.select().from(expertiseHits).where(eq(expertiseHits.id, hitId));
    expect(hit).toMatchObject({ example: null, outcome: 'pass', runId: run, where: 'page 2' });
  });

  it('counts the distinct runs a lesson was hit in', async () => {
    await seedDomain('char-runs');
    await seedLesson(runsLesson, 'char-runs');
    await seedRun(runA, 'char-runs', 1);
    await seedRun(runB, 'char-runs', 2);
    await serverDB.insert(expertiseHits).values([
      { domainId: 'char-runs', lessonId: runsLesson, outcome: 'violation', runId: runA },
      { domainId: 'char-runs', lessonId: runsLesson, outcome: 'pass', runId: runA },
      { domainId: 'char-runs', lessonId: runsLesson, outcome: 'pass', runId: runB },
    ]);
    const model = new ExpertiseModel(serverDB, userId);

    await expect(model.countLineageRuns(runsLesson)).resolves.toBe(2);
    await expect(model.countLineageRuns(missingLesson)).resolves.toBe(0);
  });
});
