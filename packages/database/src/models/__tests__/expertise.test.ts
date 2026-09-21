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
  verifyCheckResults,
  verifyRuns,
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
      brief: 'Improve production incident diagnosis, excluding general design discussions.',
      carrier: { id: 'owned-agent', type: 'agent' },
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
  const seedRuleGroup = async () => {
    const otherUserId = 'expertise-rules-other-user';
    await serverDB.insert(users).values({ id: otherUserId });
    await serverDB.insert(expertiseDomains).values([
      {
        anchorChosenAt: new Date(),
        domainFilter: '交付标准',
        id: 'rules-domain',
        slug: 'rules-domain',
        title: '我的交付审美',
        userId,
      },
      {
        anchorChosenAt: new Date(),
        domainFilter: '设计体系',
        id: 'rules-domain-2',
        slug: 'rules-domain-2',
        title: 'LobeHub 设计体系',
        userId,
      },
      {
        anchorChosenAt: new Date(),
        domainFilter: '别人的标准',
        id: 'rules-foreign-domain',
        slug: 'rules-foreign-domain',
        title: 'Foreign rules',
        userId: otherUserId,
      },
    ]);
    await serverDB.insert(expertiseBindings).values([
      { boundUserId: userId, domainId: 'rules-domain', sortOrder: 0 },
      { boundUserId: userId, domainId: 'rules-domain-2', sortOrder: 1 },
      { boundUserId: otherUserId, domainId: 'rules-foreign-domain' },
    ]);
    await serverDB.insert(expertiseLessons).values([
      {
        code: 'P-01',
        domainId: 'rules-domain',
        exampleCount: 1,
        hitCount: 2,
        hitRunCount: 5,
        id: '0d3e1a5c-6f52-4c2e-8f2a-9f2d3f26b101',
        polarity: 'rule',
        sections: [{ body: '颜色取自设计系统变量', key: 'rule' }],
        sortOrder: 1,
        title: '颜色取自设计系统变量',
      },
      {
        code: 'P-02',
        domainId: 'rules-domain',
        exampleCount: 3,
        hitCount: 7,
        hitRunCount: 9,
        id: '0d3e1a5c-6f52-4c2e-8f2a-9f2d3f26b102',
        polarity: 'rule',
        sections: [{ body: '证据要拍成功路径', key: 'rule' }],
        sortOrder: 0,
        title: '证据要拍成功路径',
      },
      {
        code: 'P-01',
        domainId: 'rules-foreign-domain',
        id: '0d3e1a5c-6f52-4c2e-8f2a-9f2d3f26b103',
        polarity: 'rule',
        sections: [{ body: 'Foreign rule', key: 'rule' }],
        title: 'Foreign rule',
      },
    ]);
    return {
      first: '0d3e1a5c-6f52-4c2e-8f2a-9f2d3f26b102',
      second: '0d3e1a5c-6f52-4c2e-8f2a-9f2d3f26b101',
    };
  };

  it("lists the rules in the owner's own groups, in the owner's order", async () => {
    await seedRuleGroup();

    const groups = await new ExpertiseModel(serverDB, userId).listRules();

    expect(groups.map((g) => g.domain.title)).toEqual(['我的交付审美', 'LobeHub 设计体系']);
    // The reviewer's own order, not hit count: they said the order matters.
    expect(groups[0].rules.map(({ code }) => code)).toEqual(['P-02', 'P-01']);
    expect(groups[0].rules[0].enforcement).toBe('remind');
    expect(groups[0].scopes).toEqual([{ id: userId, kind: 'user', title: null }]);
  });

  it('reads rules from before the columns existed as unplaced reminders', async () => {
    const { first, second } = await seedRuleGroup();
    await serverDB.insert(expertiseLessons).values({
      code: 'P-03',
      domainId: 'rules-domain',
      enforcement: null,
      id: '0d3e1a5c-6f52-4c2e-8f2a-9f2d3f26b104',
      polarity: 'rule',
      sections: [{ body: '旧规矩', key: 'rule' }],
      sortOrder: null,
      title: '旧规矩',
    });

    const [group] = await new ExpertiseModel(serverDB, userId).listRules();

    // Null sorts after every placed rule rather than jumping to the top.
    expect(group.rules.map(({ id }) => id)).toEqual([
      first,
      second,
      '0d3e1a5c-6f52-4c2e-8f2a-9f2d3f26b104',
    ]);
    expect(group.rules[2].enforcement).toBe('remind');
  });

  it('files a hand-written rule at the top of its group with the next code', async () => {
    await seedRuleGroup();
    const model = new ExpertiseModel(serverDB, userId);

    const created = await model.createRule({
      body: '主行只留一个操作',
      domainId: 'rules-domain',
      enforcement: 'block',
      title: '次要操作收进「…」',
    });

    expect(created?.code).toBe('P-03');
    const [group] = await model.listRules();
    expect(group.rules.map(({ code }) => code)).toEqual(['P-03', 'P-02', 'P-01']);
    expect(group.rules[0]).toMatchObject({
      createdByUserId: userId,
      enforcement: 'block',
      reasonKind: 'taste',
      reasonSource: 'reviewer',
      sections: [
        { body: '次要操作收进「…」', key: 'rule' },
        { body: '主行只留一个操作', key: 'why' },
      ],
    });
    // A foreign group is not a place the caller can write into.
    expect(await model.createRule({ domainId: 'rules-foreign-domain', title: 'x' })).toBeNull();
  });

  it('versions a rewording but not a switch flip', async () => {
    const { first } = await seedRuleGroup();
    const model = new ExpertiseModel(serverDB, userId);

    await model.updateRule(first, { enforcement: 'block', reasonKind: 'mechanism' });
    let lesson = await model.findLesson(first);
    expect(lesson).toMatchObject({
      currentRevision: 1,
      enforcement: 'block',
      reasonKind: 'mechanism',
    });

    await model.updateRule(first, {
      sections: { limits: '被验的就是报错态本身时除外' },
      title: '证据要拍成功路径本身',
    });
    lesson = await model.findLesson(first);
    expect(lesson?.title).toBe('证据要拍成功路径本身');
    expect(lesson?.currentRevision).toBe(2);
    expect(lesson?.sections).toEqual([
      { body: '证据要拍成功路径本身', key: 'rule' },
      { body: '被验的就是报错态本身时除外', key: 'limits' },
    ]);
    const revisions = await model.listLessonRevisions(first);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ changedBy: 'user', kind: 'user-feedback', revision: 2 });
  });

  it('writes back a dragged order for one group only', async () => {
    const { first, second } = await seedRuleGroup();
    const model = new ExpertiseModel(serverDB, userId);

    await model.reorderRules('rules-domain', [
      second,
      first,
      '0d3e1a5c-6f52-4c2e-8f2a-9f2d3f26b103',
    ]);

    const [group] = await model.listRules();
    expect(group.rules.map(({ id }) => id)).toEqual([second, first]);
    // The foreign rule named in the list was neither moved nor touched.
    const [foreign] = await serverDB
      .select({ domainId: expertiseLessons.domainId, sortOrder: expertiseLessons.sortOrder })
      .from(expertiseLessons)
      .where(eq(expertiseLessons.id, '0d3e1a5c-6f52-4c2e-8f2a-9f2d3f26b103'));
    expect(foreign).toEqual({ domainId: 'rules-foreign-domain', sortOrder: 0 });
  });

  const seedHitOn = async (lessonId: string) => {
    await serverDB.insert(expertiseRuns).values({
      actorId: 'agent-1',
      actorType: 'agent',
      domainId: 'rules-domain',
      id: runId,
      runIndex: 1,
      subjectId: 'x',
      subjectType: 'standalone',
      userId,
    });
    await serverDB.insert(expertiseHits).values({
      domainId: 'rules-domain',
      example: '你应该用 cssVar 的吧',
      id: hitId,
      lessonId,
      outcome: 'violation',
      runId,
    });
  };

  it('moves an unencumbered rule in place with a fresh code', async () => {
    const { first } = await seedRuleGroup();
    const model = new ExpertiseModel(serverDB, userId);

    expect(await model.moveRule(first, 'rules-domain-2')).toEqual({
      domainId: 'rules-domain-2',
      id: first,
    });

    const groups = await model.listRules();
    expect(groups[0].rules.map(({ id }) => id)).not.toContain(first);
    expect(groups[1].rules.map(({ code, id }) => ({ code, id }))).toEqual([
      { code: 'P-01', id: first },
    ]);
  });

  it('re-files a rule with evidence as a copy that still reads its sources', async () => {
    const { first } = await seedRuleGroup();
    await seedHitOn(first);
    const model = new ExpertiseModel(serverDB, userId);

    const moved = await model.moveRule(first, 'rules-domain-2');
    expect(moved?.id).not.toBe(first);

    const groups = await model.listRules();
    // The original is hidden, not archived: it moved, it did not stop applying.
    expect(groups.flatMap((g) => g.rules.map(({ id }) => id))).not.toContain(first);
    expect(groups[1].rules[0]).toMatchObject({
      code: 'P-01',
      hitCount: 7,
      id: moved!.id,
      title: '证据要拍成功路径',
    });
    expect((await model.listLessonSources(moved!.id)).map(({ example }) => example)).toEqual([
      '你应该用 cssVar 的吧',
    ]);
    expect(await model.findLesson(first)).toMatchObject({
      rejectedReason: `moved-to:${moved!.id}`,
      status: 'rejected',
    });
  });

  it('folds one rule into another and archives the source with a pointer back', async () => {
    const { first, second } = await seedRuleGroup();
    const model = new ExpertiseModel(serverDB, userId);

    await seedHitOn(second);
    await model.mergeRules(second, first);

    const target = await model.findLesson(first);
    expect(target).toMatchObject({
      currentRevision: 2,
      exampleCount: 4,
      generalizedFromIds: [second],
      hitCount: 9,
      hitRunCount: 14,
    });
    const source = await model.findLesson(second);
    expect(source).toMatchObject({ rejectedReason: `merged-into:${first}`, status: 'retired' });
    expect(source?.retiredAt).not.toBeNull();
    const revisions = await model.listLessonRevisions(first);
    expect(revisions[0]).toMatchObject({ feedback: '颜色取自设计系统变量', kind: 'generalize' });
    // The target reads the source's evidence through its lineage; the hit itself did not move.
    expect((await model.listLessonSources(first)).map(({ example }) => example)).toEqual([
      '你应该用 cssVar 的吧',
    ]);
    // Both still come back: the archive is part of the list.
    const [group] = await model.listRules();
    expect(group.rules.map(({ status }) => status)).toEqual(['active', 'retired']);
  });

  it('counts only the rejected rounds no distillation run has read', async () => {
    await serverDB.insert(expertiseDomains).values({
      anchorChosenAt: new Date(),
      domainFilter: '交付标准',
      id: 'backlog-domain',
      slug: 'backlog-domain',
      title: '我的交付标准',
      userId,
    });
    const readRunId = 'a3f9b0c6-6d0e-4f2e-9b1a-2c4d5e6f7a01';
    const unreadRunId = 'a3f9b0c6-6d0e-4f2e-9b1a-2c4d5e6f7a02';
    const acceptedRunId = 'a3f9b0c6-6d0e-4f2e-9b1a-2c4d5e6f7a03';
    await serverDB.insert(verifyRuns).values([
      { id: readRunId, userId },
      { id: unreadRunId, userId },
      { id: acceptedRunId, userId },
    ]);
    await serverDB.insert(verifyCheckResults).values([
      {
        checkItemId: 'chk-read',
        userDecision: 'rejected',
        userId,
        verifierType: 'llm',
        verifyRunId: readRunId,
      },
      {
        checkItemId: 'chk-unread',
        userDecision: 'rejected',
        userId,
        verifierType: 'llm',
        verifyRunId: unreadRunId,
      },
      {
        checkItemId: 'chk-accepted',
        userDecision: 'accepted',
        userId,
        verifierType: 'llm',
        verifyRunId: acceptedRunId,
      },
    ]);
    await serverDB.insert(expertiseRuns).values({
      actorId: userId,
      actorType: 'user',
      domainId: 'backlog-domain',
      id: 'a3f9b0c6-6d0e-4f2e-9b1a-2c4d5e6f7a04',
      reflectionKey: `acceptance:some-acceptance:run:${readRunId}`,
      runIndex: 1,
      subjectId: 'some-topic',
      subjectType: 'topic',
      userId,
    });

    await expect(
      new ExpertiseModel(serverDB, userId).countUndistilledRejectionRounds(),
    ).resolves.toBe(1);
  });
});
