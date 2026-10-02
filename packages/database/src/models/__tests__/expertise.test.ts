// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { ExpertiseRuleRepository } from '../../repositories/expertiseRules';
import {
  agents,
  documents,
  expertiseBindings,
  expertiseDomains,
  expertiseHits,
  expertiseInsights,
  expertiseLessons,
  expertiseRuns,
  messages,
  projects,
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

  it('points a conversation source at its topic, agent and message', async () => {
    await serverDB.insert(agents).values({ id: 'expertise-source-agent', userId });
    await serverDB.insert(topics).values({
      agentId: 'expertise-source-agent',
      id: 'expertise-source-topic',
      title: '排查生产环境连接池超时',
      userId,
    });
    await serverDB.insert(messages).values({
      content: '先看连接池指标，再动超时配置',
      id: 'expertise-source-message',
      role: 'user',
      topicId: 'expertise-source-topic',
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
      reflectionKey: 'topic:expertise-source-topic:operation:op-1',
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
      outcome: 'violation',
      runId,
      sourceMessageId: 'expertise-source-message',
    });

    const [source] = await new ExpertiseModel(serverDB, userId).listLessonSources(lessonId);
    expect(source).toMatchObject({
      fromAcceptance: false,
      messageId: 'expertise-source-message',
      topicAgentId: 'expertise-source-agent',
      topicId: 'expertise-source-topic',
    });
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

  it("lists project groups as the reviewer's, and agent self-learning after them", async () => {
    await seedRuleGroup();
    await serverDB
      .insert(agents)
      .values({ avatar: '🦊', id: 'rules-agent', title: '狐狸', userId });
    await serverDB.insert(projects).values({
      coordinatorAgentId: 'rules-agent',
      id: 'rules-project',
      identifier: 'LOBE',
      name: 'lobehub',
      userId,
    });
    await serverDB.insert(expertiseDomains).values([
      {
        anchorChosenAt: new Date(),
        domainFilter: '项目里的打回',
        id: 'project-domain',
        slug: 'project-domain',
        title: 'lobehub 的规矩',
        userId,
      },
      {
        anchorChosenAt: new Date(),
        domainFilter: '智能体专长',
        id: 'agent-domain',
        slug: 'agent-domain',
        title: '智能体专长',
        userId,
      },
    ]);
    await serverDB.insert(expertiseBindings).values([
      { domainId: 'project-domain', projectId: 'rules-project' },
      { agentId: 'rules-agent', domainId: 'agent-domain' },
    ]);

    const groups = await new ExpertiseModel(serverDB, userId).listRules();

    expect(groups.find((g) => g.domain.id === 'project-domain')?.owner).toEqual({ kind: 'mine' });
    expect(groups.find((g) => g.domain.id === 'project-domain')?.scopes).toEqual([
      { id: 'rules-project', kind: 'project', title: 'lobehub' },
    ]);
    // Agent self-learning is listed too, owned by its agent, after every group of the reviewer's.
    expect(groups.at(-1)?.domain.id).toBe('agent-domain');
    expect(groups.at(-1)?.owner).toEqual({
      agent: { avatar: '🦊', backgroundColor: null, id: 'rules-agent', title: '狐狸' },
      kind: 'agent',
    });
    expect(groups.slice(0, -1).every((g) => g.owner.kind === 'mine')).toBe(true);
  });

  it("leaves out what a teammate's private agent learned", async () => {
    const teammate = 'expertise-rules-private-learner';
    const workspaceId = 'rules-private-learner-workspace';
    await serverDB.insert(users).values({ id: teammate });
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'Team',
      primaryOwnerId: userId,
      slug: 'rules-private-learner',
    });
    await serverDB.insert(agents).values({
      id: 'private-learner',
      title: '队友的私有助手',
      userId: teammate,
      visibility: 'private',
      workspaceId,
    });
    await serverDB.insert(expertiseDomains).values({
      anchorChosenAt: new Date(),
      domainFilter: '私有专长',
      id: 'private-learned-domain',
      slug: 'private-learned-domain',
      title: '私有专长',
      userId: teammate,
      workspaceId,
    });
    await serverDB
      .insert(expertiseBindings)
      .values({ agentId: 'private-learner', domainId: 'private-learned-domain' });

    const groups = await new ExpertiseModel(serverDB, userId, workspaceId).listRules();

    expect(groups.map((g) => g.domain.id)).not.toContain('private-learned-domain');
  });

  it('files a hand-written rule at the top of its group with the next code', async () => {
    await seedRuleGroup();
    const model = new ExpertiseModel(serverDB, userId);

    const created = await model.createRule({
      domainId: 'rules-domain',
      enforcement: 'block',
      limits: '   ',
      title: '次要操作收进「…」',
      why: '主行只留一个操作',
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

    await new ExpertiseRuleRepository(serverDB, userId).updateRule(first, {
      enforcement: 'block',
      reasonKind: 'mechanism',
    });
    let lesson = await model.findLesson(first);
    expect(lesson).toMatchObject({
      currentRevision: 1,
      enforcement: 'block',
      reasonKind: 'mechanism',
    });

    await new ExpertiseRuleRepository(serverDB, userId).updateRule(first, {
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

  it('numbers revisions from the row, and a switch flip never writes one back', async () => {
    const { first } = await seedRuleGroup();
    const rules = new ExpertiseRuleRepository(serverDB, userId);
    const model = new ExpertiseModel(serverDB, userId);
    await rules.updateRule(first, { title: '第二版' });
    await rules.updateRule(first, { title: '第三版' });

    await rules.updateRule(first, { enforcement: 'block' });
    expect((await model.findLesson(first))?.currentRevision).toBe(3);

    await expect(rules.updateRule(first, { title: '第四版' })).resolves.toMatchObject({
      revision: 4,
    });
  });

  it('keeps both of two concurrent edits to different sections', async () => {
    const { first } = await seedRuleGroup();
    const rules = new ExpertiseRuleRepository(serverDB, userId);

    // Two members save different sections of the same rule at the same moment.
    const results = await Promise.all([
      rules.updateRule(first, { sections: { why: '截图要能复现' } }),
      rules.updateRule(first, { sections: { limits: '报错态本身除外' } }),
    ]);

    expect(results.map((r) => r?.revision).sort()).toEqual([2, 3]);
    const lesson = await new ExpertiseModel(serverDB, userId).findLesson(first);
    expect(lesson?.currentRevision).toBe(3);
    expect(lesson?.sections).toEqual(
      expect.arrayContaining([
        { body: '截图要能复现', key: 'why' },
        { body: '报错态本身除外', key: 'limits' },
      ]),
    );
  });

  it("tells a member which edits to a shared rule were a teammate's", async () => {
    const teammate = 'expertise-rules-editor-teammate';
    const workspaceId = 'rules-editor-workspace';
    await serverDB.insert(users).values({ id: teammate });
    await serverDB
      .insert(workspaces)
      .values({ id: workspaceId, name: 'Team', primaryOwnerId: userId, slug: 'rules-editor-team' });
    await serverDB.insert(expertiseDomains).values({
      anchorChosenAt: new Date(),
      domainFilter: '团队规矩',
      id: 'edited-domain',
      slug: 'edited-domain',
      title: '团队规矩',
      userId,
      visibility: 'public',
      workspaceId,
    });
    const lesson = '0d3e1a5c-6f52-4c2e-8f2a-9f2d3f26b107';
    await serverDB.insert(expertiseLessons).values({
      code: 'P-01',
      domainId: 'edited-domain',
      id: lesson,
      polarity: 'rule',
      sections: [{ body: '共享规矩', key: 'rule' }],
      title: '共享规矩',
    });

    await new ExpertiseRuleRepository(serverDB, teammate, workspaceId).updateRule(lesson, {
      title: '队友改过的规矩',
    });

    const [mine] = await new ExpertiseModel(serverDB, userId, workspaceId).listLessonRevisions(
      lesson,
    );
    const [theirs] = await new ExpertiseModel(serverDB, teammate, workspaceId).listLessonRevisions(
      lesson,
    );
    expect(mine.byViewer).toBe(false);
    expect(mine).not.toHaveProperty('changedByUserId');
    expect(theirs.byViewer).toBe(true);
  });

  it("does not name a teammate's private agent among a shared group's mounts", async () => {
    const teammate = 'expertise-rules-mount-teammate';
    const workspaceId = 'rules-mount-workspace';
    await serverDB.insert(users).values({ id: teammate });
    await serverDB
      .insert(workspaces)
      .values({ id: workspaceId, name: 'Team', primaryOwnerId: userId, slug: 'rules-mount-team' });
    await serverDB.insert(agents).values([
      {
        id: 'teammate-private-agent',
        title: '队友的私有助手',
        userId: teammate,
        visibility: 'private',
        workspaceId,
      },
      {
        id: 'teammate-public-agent',
        title: '团队助手',
        userId: teammate,
        visibility: 'public',
        workspaceId,
      },
    ]);
    await serverDB.insert(expertiseDomains).values({
      anchorChosenAt: new Date(),
      domainFilter: '团队规矩',
      id: 'mounted-domain',
      slug: 'mounted-domain',
      title: '团队规矩',
      userId,
      workspaceId,
    });
    await serverDB.insert(expertiseBindings).values([
      { boundWorkspaceId: workspaceId, domainId: 'mounted-domain', sortOrder: 0 },
      { agentId: 'teammate-private-agent', domainId: 'mounted-domain', sortOrder: 1 },
      { agentId: 'teammate-public-agent', domainId: 'mounted-domain', sortOrder: 2 },
    ]);

    const [group] = await new ExpertiseModel(serverDB, userId, workspaceId).listRules();

    expect(group.scopes).toEqual([
      { id: workspaceId, kind: 'workspace', title: null },
      { id: 'teammate-public-agent', kind: 'agent', title: '团队助手' },
    ]);
  });

  it("moves one rule within its group from the server's own order", async () => {
    const { first, second } = await seedRuleGroup();
    const model = new ExpertiseModel(serverDB, userId);

    // Seeded order is [second, first]; move `first` to the top.
    await model.reorderRule('rules-domain', first, second);
    expect((await model.listRules())[0].rules.map(({ id }) => id)).toEqual([first, second]);

    // And back to the end.
    await model.reorderRule('rules-domain', first, null);
    expect((await model.listRules())[0].rules.map(({ id }) => id)).toEqual([second, first]);

    // A rule from another group cannot be pulled in through this group.
    expect(
      await model.reorderRule('rules-domain', '0d3e1a5c-6f52-4c2e-8f2a-9f2d3f26b103', null),
    ).toBeNull();
    const [foreign] = await serverDB
      .select({ domainId: expertiseLessons.domainId, sortOrder: expertiseLessons.sortOrder })
      .from(expertiseLessons)
      .where(eq(expertiseLessons.id, '0d3e1a5c-6f52-4c2e-8f2a-9f2d3f26b103'));
    expect(foreign).toEqual({ domainId: 'rules-foreign-domain', sortOrder: 0 });
  });

  it("keeps a hand-written rule marked as the reviewer's after it starts being hit", async () => {
    await seedRuleGroup();
    const model = new ExpertiseModel(serverDB, userId);
    const created = await model.createRule({ domainId: 'rules-domain', title: '主行只留一个操作' });
    await serverDB
      .update(expertiseLessons)
      .set({ hitCount: 3, hitRunCount: 2 })
      .where(eq(expertiseLessons.id, created!.id));

    const [group] = await model.listRules();
    expect(group.rules.find((r) => r.id === created!.id)?.authored).toBe(true);
    // Distilled rules (no author) are never marked as the reviewer's own.
    expect(group.rules.filter((r) => r.id !== created!.id).every((r) => !r.authored)).toBe(true);
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

  const seedAgentLesson = async () => {
    await serverDB.insert(agents).values({ id: 'reach-agent', title: '狐狸', userId });
    await serverDB.insert(expertiseDomains).values({
      anchorChosenAt: new Date(),
      domainFilter: '智能体专长',
      id: 'reach-agent-domain',
      slug: 'reach-agent-domain',
      title: '狐狸学到的',
      userId,
    });
    await serverDB
      .insert(expertiseBindings)
      .values({ agentId: 'reach-agent', domainId: 'reach-agent-domain' });
    const id = '0d3e1a5c-6f52-4c2e-8f2a-9f2d3f26b1a1';
    await serverDB.insert(expertiseLessons).values({
      code: 'P-01',
      domainId: 'reach-agent-domain',
      id,
      polarity: 'rule',
      sections: [{ body: '空状态给出下一步', key: 'rule' }],
      title: '空状态给出下一步',
    });
    return id;
  };

  it("refuses to move the reviewer's rule into an agent's lessons", async () => {
    const { first } = await seedRuleGroup();
    await seedAgentLesson();
    const model = new ExpertiseModel(serverDB, userId);

    expect(await model.moveRule(first, 'reach-agent-domain')).toBeNull();

    const [row] = await serverDB
      .select({ domainId: expertiseLessons.domainId, status: expertiseLessons.status })
      .from(expertiseLessons)
      .where(eq(expertiseLessons.id, first));
    expect(row).toEqual({ domainId: 'rules-domain', status: 'active' });
  });

  it("refuses to merge across the reviewer's rules and an agent's lessons", async () => {
    const { first } = await seedRuleGroup();
    const agentLesson = await seedAgentLesson();
    const repository = new ExpertiseRuleRepository(serverDB, userId);

    expect(await repository.mergeRules(first, agentLesson)).toBeNull();
    expect(await repository.mergeRules(agentLesson, first)).toBeNull();

    const rows = await serverDB
      .select({ id: expertiseLessons.id, status: expertiseLessons.status })
      .from(expertiseLessons)
      .where(inArray(expertiseLessons.id, [first, agentLesson]));
    expect(rows.every((row) => row.status === 'active')).toBe(true);
  });

  it('files rules distilled from a document and records a restatement on the rule it repeats', async () => {
    const { first } = await seedRuleGroup();
    await serverDB.insert(documents).values({
      content: '交付前必须 rebase 到 canary。',
      fileType: 'markdown',
      id: 'distill-doc',
      source: 'document',
      sourceType: 'api',
      title: '工程规范',
      totalCharCount: 20,
      totalLineCount: 1,
      userId,
    });
    const repository = new ExpertiseRuleRepository(serverDB, userId);

    const results = await repository.commitDistilled(
      { subjectId: 'distill-doc', subjectType: 'document', title: '工程规范', type: 'document' },
      [
        {
          domainId: 'rules-domain',
          kind: 'create',
          quote: '交付前必须 rebase 到 canary。',
          rule: { enforcement: 'block', title: '交付前先 rebase 到 canary' },
        },
        { intoId: first, kind: 'merge', quote: '证据只拍成功路径' },
      ],
    );

    expect(results.map(({ kind }) => kind)).toEqual(['create', 'merge']);
    const created = results[0].id;
    const model = new ExpertiseModel(serverDB, userId);
    const rules = (await model.listRules()).flatMap((group) => group.rules);
    // Read from a material: counted apart from rejections and conversations, and not "yours".
    expect(rules.find(({ id }) => id === created)).toMatchObject({
      authored: false,
      conversationHitCount: 0,
      enforcement: 'block',
      materialHitCount: 1,
      rejectionHitCount: 0,
    });
    expect(rules.find(({ id }) => id === first)).toMatchObject({ materialHitCount: 1 });

    const [source] = await model.listLessonSources(created);
    expect(source).toMatchObject({
      documentId: 'distill-doc',
      example: '交付前必须 rebase 到 canary。',
      fromAcceptance: false,
      materialType: 'document',
      where: '工程规范',
    });
  });

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

  it('refuses to fold into, or restore, a rule a merge already accounted for', async () => {
    const { first, second } = await seedRuleGroup();
    const model = new ExpertiseModel(serverDB, userId);
    await new ExpertiseRuleRepository(serverDB, userId).mergeRules(second, first);

    // The source now lives inside the target; restoring it would count its history twice.
    expect(await model.restoreLesson(second)).toBeNull();
    expect(await model.findLesson(second)).toMatchObject({ status: 'retired' });

    // An archived rule is not a merge target: nothing would be left in force.
    const third = '0d3e1a5c-6f52-4c2e-8f2a-9f2d3f26b105';
    await serverDB.insert(expertiseLessons).values({
      code: 'P-03',
      domainId: 'rules-domain',
      id: third,
      polarity: 'rule',
      sections: [{ body: '第三条', key: 'rule' }],
      title: '第三条',
    });
    expect(
      await new ExpertiseRuleRepository(serverDB, userId).mergeRules(third, second),
    ).toBeNull();
    expect(await model.findLesson(third)).toMatchObject({ status: 'active' });
    expect(await model.findLesson(first)).toMatchObject({ hitCount: 9 });
  });

  it('counts a run both rules were proven in once after a merge', async () => {
    const { first, second } = await seedRuleGroup();
    await serverDB.insert(expertiseRuns).values([
      {
        actorId: 'agent-1',
        actorType: 'agent',
        domainId: 'rules-domain',
        id: runId,
        runIndex: 1,
        subjectId: 'x',
        subjectType: 'standalone',
        userId,
      },
      {
        actorId: 'agent-1',
        actorType: 'agent',
        domainId: 'rules-domain',
        id: 'd3f9b0c6-6d0e-4f2e-9b1a-2c4d5e6f7a01',
        runIndex: 2,
        subjectId: 'y',
        subjectType: 'standalone',
        userId,
      },
    ]);
    // Both rules were hit in the same run, and `first` once more in another one.
    await serverDB.insert(expertiseHits).values([
      { domainId: 'rules-domain', lessonId: first, outcome: 'violation', runId },
      { domainId: 'rules-domain', lessonId: second, outcome: 'violation', runId },
      {
        domainId: 'rules-domain',
        lessonId: first,
        outcome: 'violation',
        runId: 'd3f9b0c6-6d0e-4f2e-9b1a-2c4d5e6f7a01',
      },
    ]);
    const model = new ExpertiseModel(serverDB, userId);

    await new ExpertiseRuleRepository(serverDB, userId).mergeRules(second, first);

    expect((await model.findLesson(first))?.hitRunCount).toBe(2);
  });

  it('keeps the exclusion a group was opened with', async () => {
    const model = new ExpertiseModel(serverDB, userId);
    const id = await model.createRuleGroup({
      gate: '只对本仓库成立吗？',
      outOfScope: '和仓库无关的交付审美',
      title: 'OSS 工程规范',
    });

    const [group] = await model.listRules();
    expect(group.domain).toMatchObject({ id, outOfScope: '和仓库无关的交付审美' });

    await model.updateRuleGroup(id, { outOfScope: null });
    const [cleared] = await model.listRules();
    expect(cleared.domain.outOfScope).toBeNull();
  });

  it('keeps the evidence of a rule merged twice over', async () => {
    const { first, second } = await seedRuleGroup();
    await seedHitOn(second);
    const third = '0d3e1a5c-6f52-4c2e-8f2a-9f2d3f26b105';
    await serverDB.insert(expertiseLessons).values({
      code: 'P-03',
      domainId: 'rules-domain',
      id: third,
      polarity: 'rule',
      sections: [{ body: '第三条', key: 'rule' }],
      title: '第三条',
    });
    const model = new ExpertiseModel(serverDB, userId);

    await new ExpertiseRuleRepository(serverDB, userId).mergeRules(second, first);
    await new ExpertiseRuleRepository(serverDB, userId).mergeRules(first, third);

    // The hit sits on the grandparent of `third`; one level of lineage would lose it.
    expect((await model.listLessonSources(third)).map(({ example }) => example)).toEqual([
      '你应该用 cssVar 的吧',
    ]);
  });

  it("does not show a teammate's private round behind a shared rule", async () => {
    const teammate = 'expertise-rules-teammate';
    const workspaceId = 'rules-workspace';
    await serverDB.insert(users).values({ id: teammate });
    await serverDB
      .insert(workspaces)
      .values({ id: workspaceId, name: 'Team', primaryOwnerId: userId, slug: 'rules-team' });
    await serverDB.insert(expertiseDomains).values({
      anchorChosenAt: new Date(),
      domainFilter: '团队规矩',
      id: 'shared-domain',
      slug: 'shared-domain',
      title: '团队规矩',
      userId,
      workspaceId,
    });
    const lesson = '0d3e1a5c-6f52-4c2e-8f2a-9f2d3f26b106';
    await serverDB.insert(expertiseLessons).values({
      code: 'P-01',
      domainId: 'shared-domain',
      id: lesson,
      polarity: 'rule',
      sections: [{ body: '共享规矩', key: 'rule' }],
      title: '共享规矩',
    });
    await serverDB.insert(expertiseRuns).values({
      actorId: 'agent-1',
      actorType: 'agent',
      domainId: 'shared-domain',
      id: runId,
      runIndex: 1,
      subjectId: 'x',
      subjectType: 'standalone',
      userId,
      workspaceId,
    });
    const privateRun = 'b3f9b0c6-6d0e-4f2e-9b1a-2c4d5e6f7a01';
    const publicRun = 'b3f9b0c6-6d0e-4f2e-9b1a-2c4d5e6f7a02';
    await serverDB.insert(verifyRuns).values([
      { id: privateRun, userId: teammate, visibility: 'private', workspaceId },
      { id: publicRun, userId: teammate, visibility: 'public', workspaceId },
    ]);
    const [privateCheck, publicCheck] = await serverDB
      .insert(verifyCheckResults)
      .values([
        {
          checkItemId: 'chk-private',
          checkItemTitle: '私有轮次的检查项',
          userDecision: 'rejected',
          userId: teammate,
          verifierType: 'llm',
          verifyRunId: privateRun,
          workspaceId,
        },
        {
          checkItemId: 'chk-public',
          checkItemTitle: '公开轮次的检查项',
          userDecision: 'rejected',
          userId: teammate,
          verifierType: 'llm',
          verifyRunId: publicRun,
          workspaceId,
        },
      ])
      .returning({ id: verifyCheckResults.id });
    await serverDB.insert(expertiseHits).values([
      {
        domainId: 'shared-domain',
        lessonId: lesson,
        outcome: 'violation',
        runId,
        sourceCheckResultId: privateCheck.id,
      },
      {
        domainId: 'shared-domain',
        lessonId: lesson,
        outcome: 'violation',
        runId,
        sourceCheckResultId: publicCheck.id,
      },
    ]);

    // Hits whose round is not linked: one from the teammate's run, one from the viewer's own.
    const teammateRun = 'b3f9b0c6-6d0e-4f2e-9b1a-2c4d5e6f7a09';
    await serverDB.insert(expertiseRuns).values({
      actorId: 'agent-2',
      actorType: 'agent',
      domainId: 'shared-domain',
      id: teammateRun,
      runIndex: 2,
      subjectId: 'z',
      subjectType: 'standalone',
      userId: teammate,
      workspaceId,
    });
    await serverDB.insert(expertiseHits).values([
      {
        domainId: 'shared-domain',
        example: '队友私下的原话',
        lessonId: lesson,
        outcome: 'violation',
        runId: teammateRun,
      },
      {
        domainId: 'shared-domain',
        example: '我自己的原话',
        lessonId: lesson,
        outcome: 'violation',
        runId,
      },
    ]);

    const sources = await new ExpertiseModel(serverDB, userId, workspaceId).listLessonSources(
      lesson,
    );

    expect(sources.map(({ checkTitle }) => checkTitle)).toContain('公开轮次的检查项');
    expect(sources.map(({ checkTitle }) => checkTitle)).not.toContain('私有轮次的检查项');
    expect(sources.map(({ example }) => example)).toContain('我自己的原话');
    expect(sources.map(({ example }) => example)).not.toContain('队友私下的原话');
  });

  it('reuses a group the reviewer already has instead of opening a second one', async () => {
    await seedRuleGroup();
    const model = new ExpertiseModel(serverDB, userId);

    const reused = await model.createRuleGroup({ gate: '别的守门题', title: '  我的交付审美 ' });
    expect(reused).toBe('rules-domain');

    const opened = await model.createRuleGroup({
      gate: '这条只对本仓库成立吗？',
      title: 'OSS 工程规范',
    });
    expect(opened).not.toBe('rules-domain');

    const groups = await model.listRules();
    // The newly opened group lands after the ones already there, not at the top.
    expect(groups.map((g) => g.domain.title)).toEqual([
      '我的交付审美',
      'LobeHub 设计体系',
      'OSS 工程规范',
    ]);
    // The reused group keeps its own gate question; the caller does not get to overwrite it.
    expect(groups[0].domain.domainFilter).toBe('交付标准');
  });

  it('tells rejections apart from conversation sightings, through a move', async () => {
    const { first } = await seedRuleGroup();
    const topicRunId = 'e3f9b0c6-6d0e-4f2e-9b1a-2c4d5e6f7a02';
    await serverDB.insert(expertiseRuns).values([
      {
        actorId: userId,
        actorType: 'user',
        domainId: 'rules-domain',
        id: runId,
        reflectionKey: 'acceptance:acc-1:run:run-1',
        runIndex: 1,
        subjectId: 'x',
        subjectType: 'standalone',
        userId,
      },
      {
        actorId: 'agent-1',
        actorType: 'agent',
        domainId: 'rules-domain',
        id: topicRunId,
        reflectionKey: 'topic:topic-1:operation:op-1',
        runIndex: 2,
        subjectId: 'topic-1',
        subjectType: 'topic',
        userId,
      },
    ]);
    await serverDB.insert(expertiseHits).values(
      [runId, topicRunId, topicRunId].map((run) => ({
        domainId: 'rules-domain',
        example: '证据',
        lessonId: first,
        outcome: 'violation' as const,
        runId: run,
      })),
    );
    const model = new ExpertiseModel(serverDB, userId);

    const moved = await model.moveRule(first, 'rules-domain-2');

    // The hits stayed on the original; the copy reads them through its lineage.
    const groups = await model.listRules();
    expect(groups[1].rules.find(({ id }) => id === moved!.id)).toMatchObject({
      conversationHitCount: 2,
      rejectionHitCount: 1,
    });
    // Each source is labelled by the run it came from, not by whether its check still exists.
    const sources = await model.listLessonSources(moved!.id);
    expect(sources.filter(({ fromAcceptance }) => fromAcceptance)).toHaveLength(1);
    expect(sources.filter(({ fromAcceptance }) => !fromAcceptance)).toHaveLength(2);
  });

  it('refuses to move a rule a merge folded in after it was read', async () => {
    const { first, second } = await seedRuleGroup();
    await seedHitOn(second);
    const model = new ExpertiseModel(serverDB, userId);
    const stale = await model.findLesson(second);
    await new ExpertiseRuleRepository(serverDB, userId).mergeRules(second, first);
    // The move read the rule before the merge committed.
    vi.spyOn(model, 'findLesson').mockResolvedValueOnce(stale);

    expect(await model.moveRule(second, 'rules-domain-2')).toBeNull();
    expect(await model.findLesson(second)).toMatchObject({
      rejectedReason: `merged-into:${first}`,
      status: 'retired',
    });
    const groups = await model.listRules();
    expect(groups[1].rules).toHaveLength(0);
  });

  it('keeps the edit history of a rule re-filed with its evidence', async () => {
    const { first } = await seedRuleGroup();
    await seedHitOn(first);
    const model = new ExpertiseModel(serverDB, userId);
    await new ExpertiseRuleRepository(serverDB, userId).updateRule(first, {
      title: '证据要拍成功路径本身',
    });

    const moved = await model.moveRule(first, 'rules-domain-2');

    expect(moved?.id).not.toBe(first);
    expect((await model.listLessonRevisions(moved!.id)).map(({ prevTitle }) => prevTitle)).toEqual([
      '证据要拍成功路径',
    ]);
  });

  it('folds one rule into another and archives the source with a pointer back', async () => {
    const { first, second } = await seedRuleGroup();
    const model = new ExpertiseModel(serverDB, userId);

    await seedHitOn(second);
    await new ExpertiseRuleRepository(serverDB, userId).mergeRules(second, first);

    const target = await model.findLesson(first);
    expect(target).toMatchObject({
      currentRevision: 2,
      exampleCount: 4,
      generalizedFromIds: [second],
      hitCount: 9,
      // Recounted from the hits, not summed: the seeded counters were placeholders.
      hitRunCount: 1,
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

  it('counts the backlog of the scope being viewed only', async () => {
    const workspaceId = 'backlog-workspace';
    await serverDB
      .insert(workspaces)
      .values({ id: workspaceId, name: 'Team', primaryOwnerId: userId, slug: 'backlog-team' });
    const personalRun = 'c3f9b0c6-6d0e-4f2e-9b1a-2c4d5e6f7a01';
    const workspaceRun = 'c3f9b0c6-6d0e-4f2e-9b1a-2c4d5e6f7a02';
    await serverDB.insert(verifyRuns).values([
      { id: personalRun, userId },
      { id: workspaceRun, userId, workspaceId },
    ]);
    await serverDB.insert(verifyCheckResults).values([
      {
        checkItemId: 'chk-personal',
        userDecision: 'rejected',
        userId,
        verifierType: 'llm',
        verifyRunId: personalRun,
      },
      {
        checkItemId: 'chk-workspace',
        userDecision: 'rejected',
        userId,
        verifierType: 'llm',
        verifyRunId: workspaceRun,
        workspaceId,
      },
    ]);

    await expect(
      new ExpertiseModel(serverDB, userId).countUndistilledRejectionRounds(),
    ).resolves.toBe(1);
    await expect(
      new ExpertiseModel(serverDB, userId, workspaceId).countUndistilledRejectionRounds(),
    ).resolves.toBe(1);
  });
});
