// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agents,
  expertiseBindings,
  expertiseDomains,
  expertiseHits,
  expertiseInsights,
  expertiseLessons,
  expertiseRuns,
  topics,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ExpertiseModel } from '../expertise';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'expertise-model-test-user';
const runId = '6432288d-281b-4ffa-839f-8e8f45502f57';
const lessonId = '7e21f858-688d-4a20-9866-51a256f2154a';
const hitId = 'f72c127c-9fc5-4122-8824-8955c6520c03';

describe('ExpertiseModel', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values({ id: userId });
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  it('returns the source topic title for a lesson hit', async () => {
    await serverDB.insert(topics).values({
      id: 'expertise-source-topic',
      title: '排查生产环境连接池超时',
      userId,
    });
    await serverDB.insert(expertiseDomains).values({
      domainFilter: '生产故障排查',
      id: 'expertise-test-domain',
      slug: 'expertise-test-domain',
      title: '生产故障排查',
      userId,
    });
    await serverDB.insert(expertiseRuns).values({
      actorId: 'agent-1',
      actorType: 'agent',
      domainId: 'expertise-test-domain',
      id: runId,
      runIndex: 1,
      subjectId: 'expertise-source-topic',
      subjectType: 'topic',
      userId,
    });
    await serverDB.insert(expertiseLessons).values({
      code: 'P-01',
      domainId: 'expertise-test-domain',
      id: lessonId,
      polarity: 'rule',
      sections: [{ body: '先看连接池指标', key: 'rule' }],
      title: '先看连接池指标',
    });
    await serverDB.insert(expertiseHits).values({
      domainId: 'expertise-test-domain',
      id: hitId,
      lessonId,
      outcome: 'pass',
      runId,
    });

    const [hit] = await new ExpertiseModel(serverDB, userId).listLessonHits(lessonId);

    expect(hit.runTitle).toBe('排查生产环境连接池超时');
    expect(hit.subjectId).toBe('expertise-source-topic');
  });

  it('does not resolve domains through an agent owned by another user', async () => {
    const foreignUserId = 'expertise-foreign-user';
    await serverDB.insert(users).values({ id: foreignUserId });
    await serverDB.insert(agents).values({ id: 'foreign-agent', userId: foreignUserId });
    await serverDB.insert(expertiseDomains).values({
      anchorChosenAt: new Date(),
      domainFilter: 'Foreign domain',
      id: 'foreign-domain',
      slug: 'foreign-domain',
      title: 'Foreign domain',
      userId: foreignUserId,
    });
    await serverDB.insert(expertiseBindings).values({
      agentId: 'foreign-agent',
      domainId: 'foreign-domain',
    });

    await expect(
      new ExpertiseModel(serverDB, userId).listDomainsForAgent('foreign-agent'),
    ).resolves.toEqual([]);
  });

  it('does not expose lesson detail or evidence from another user domain', async () => {
    const foreignUserId = 'expertise-foreign-lesson-user';
    const foreignLessonId = '5c661584-9ee7-49d4-8623-573243f3c51a';
    await serverDB.insert(users).values({ id: foreignUserId });
    await serverDB.insert(expertiseDomains).values({
      anchorChosenAt: new Date(),
      domainFilter: 'Foreign domain',
      id: 'foreign-lesson-domain',
      slug: 'foreign-lesson-domain',
      title: 'Foreign domain',
      userId: foreignUserId,
    });
    await serverDB.insert(expertiseLessons).values({
      code: 'P-01',
      domainId: 'foreign-lesson-domain',
      id: foreignLessonId,
      polarity: 'rule',
      sections: [],
      title: 'Foreign lesson',
    });

    const model = new ExpertiseModel(serverDB, userId);
    await expect(model.findLesson(foreignLessonId)).resolves.toBeUndefined();
    await expect(model.listLessons('foreign-lesson-domain')).resolves.toEqual([]);
    await expect(model.listLessonHits(foreignLessonId)).resolves.toEqual([]);
  });

  it('persists a generated domain definition and resolves its agent binding', async () => {
    await serverDB.insert(agents).values({ id: 'owned-agent', userId });
    const model = new ExpertiseModel(serverDB, userId);

    const domainId = await model.createDomain({
      agentId: 'owned-agent',
      brief: 'Improve production incident diagnosis, excluding general design discussions.',
      domainFilter: 'Include production incident diagnosis and remediation.',
      outOfScope: 'Exclude general design discussions without an incident.',
      title: 'Production incident response',
    });

    const [binding] = await serverDB
      .select()
      .from(expertiseBindings)
      .where(eq(expertiseBindings.domainId, domainId));
    const [resolved] = await model.listDomainsForAgent('owned-agent');

    expect(binding.agentId).toBe('owned-agent');
    expect(resolved.domain).toMatchObject({
      description: 'Improve production incident diagnosis, excluding general design discussions.',
      domainFilter: 'Include production incident diagnosis and remediation.',
      id: domainId,
      outOfScope: 'Exclude general design discussions without an incident.',
      title: 'Production incident response',
    });
  });

  it('marks only directly taught lessons as taught by the user', async () => {
    await serverDB.insert(expertiseDomains).values({
      anchorChosenAt: new Date(),
      domainFilter: 'Taught domain',
      id: 'taught-domain',
      slug: 'taught-domain',
      title: 'Taught domain',
      userId,
    });
    await serverDB.insert(expertiseRuns).values({
      actorId: 'agent-1',
      actorType: 'agent',
      domainId: 'taught-domain',
      id: runId,
      runIndex: 1,
      subjectId: 'some-topic',
      subjectType: 'topic',
      userId,
    });
    // Older ingestion runs stamped the acting user on distilled lessons as well.
    await serverDB.insert(expertiseLessons).values({
      code: 'P-01',
      createdByUserId: userId,
      domainId: 'taught-domain',
      id: lessonId,
      originRunId: runId,
      polarity: 'rule',
      sections: [{ body: 'distilled', key: 'rule' }],
      title: 'distilled',
    });
    const model = new ExpertiseModel(serverDB, userId);
    const taught = await model.teachLesson({ domainId: 'taught-domain', text: 'taught' });

    const lessons = await model.listLessonsWithRecent(['taught-domain']);

    expect(lessons.map((l) => [l.title, l.taughtByUser])).toEqual([
      ['distilled', false],
      ['taught', true],
    ]);
    expect(taught?.code).toBe('P-02');
  });

  it('deletes an owned domain with everything learned in it, and nothing else', async () => {
    const foreignUserId = 'expertise-delete-foreign-user';
    await serverDB.insert(users).values({ id: foreignUserId });
    await serverDB.insert(agents).values({ id: 'delete-agent', userId });
    await serverDB.insert(expertiseDomains).values([
      {
        anchorChosenAt: new Date(),
        domainFilter: 'Mine',
        id: 'delete-domain',
        slug: 'delete-domain',
        title: 'Mine',
        userId,
      },
      {
        anchorChosenAt: new Date(),
        domainFilter: 'Theirs',
        id: 'delete-foreign-domain',
        slug: 'delete-foreign-domain',
        title: 'Theirs',
        userId: foreignUserId,
      },
    ]);
    await serverDB.insert(expertiseBindings).values({
      agentId: 'delete-agent',
      domainId: 'delete-domain',
    });
    await serverDB.insert(expertiseRuns).values({
      actorId: 'delete-agent',
      actorType: 'agent',
      domainId: 'delete-domain',
      id: runId,
      runIndex: 1,
      subjectId: 'topic',
      subjectType: 'topic',
      userId,
    });
    await serverDB.insert(expertiseLessons).values({
      code: 'P-01',
      domainId: 'delete-domain',
      id: lessonId,
      polarity: 'rule',
      sections: [],
      title: 'lesson',
    });
    await serverDB.insert(expertiseHits).values({
      domainId: 'delete-domain',
      id: hitId,
      lessonId,
      outcome: 'pass',
      runId,
    });
    const model = new ExpertiseModel(serverDB, userId);

    await expect(model.deleteDomain('delete-foreign-domain')).resolves.toBeNull();
    await expect(model.deleteDomain('delete-domain')).resolves.toEqual({ id: 'delete-domain' });

    await expect(model.listDomainsForAgent('delete-agent')).resolves.toEqual([]);
    await expect(serverDB.select().from(expertiseLessons)).resolves.toEqual([]);
    await expect(serverDB.select().from(expertiseHits)).resolves.toEqual([]);
    await expect(serverDB.select().from(expertiseRuns)).resolves.toEqual([]);
    const remaining = await serverDB.select({ id: expertiseDomains.id }).from(expertiseDomains);
    expect(remaining).toEqual([{ id: 'delete-foreign-domain' }]);
  });

  it('keeps cross-domain insights isolated to the active workspace', async () => {
    await serverDB.insert(workspaces).values([
      { id: 'expertise-workspace-1', name: 'Workspace 1', primaryOwnerId: userId, slug: 'ws-1' },
      { id: 'expertise-workspace-2', name: 'Workspace 2', primaryOwnerId: userId, slug: 'ws-2' },
    ]);
    await serverDB.insert(expertiseDomains).values({
      anchorChosenAt: new Date(),
      domainFilter: 'Workspace domain',
      id: 'workspace-domain-1',
      slug: 'workspace-domain-1',
      title: 'Workspace domain',
      userId,
      workspaceId: 'expertise-workspace-1',
    });
    const workspaceOneInsightId = 'b77316f6-c807-47f0-b3b8-ab9220aca7fb';
    const workspaceTwoInsightId = 'f5976e3b-d445-4359-98c3-92a64bbd0553';
    await serverDB.insert(expertiseInsights).values([
      {
        body: 'Visible in workspace one',
        headline: 'Workspace one insight',
        id: workspaceOneInsightId,
        kind: 'repeated-mistake',
        userId,
        workspaceId: 'expertise-workspace-1',
      },
      {
        body: 'Hidden in workspace one',
        headline: 'Workspace two insight',
        id: workspaceTwoInsightId,
        kind: 'repeated-mistake',
        userId,
        workspaceId: 'expertise-workspace-2',
      },
    ]);

    const model = new ExpertiseModel(serverDB, userId, 'expertise-workspace-1');
    const insights = await model.listInsights(['workspace-domain-1']);
    await model.dismissInsight(workspaceTwoInsightId, 'must remain untouched');
    const [foreignInsight] = await serverDB
      .select({ status: expertiseInsights.status })
      .from(expertiseInsights)
      .where(eq(expertiseInsights.id, workspaceTwoInsightId));

    expect(insights.map(({ id }) => id)).toEqual([workspaceOneInsightId]);
    expect(foreignInsight.status).toBe('active');
  });
});
