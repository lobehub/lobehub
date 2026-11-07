// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { GoalModel } from '@/database/models/goal';
import type { LobeChatDatabase } from '@/database/type';

import { GoalCriteriaGeneratorService } from '../../criteriaGenerator';
import { registerGoalServiceTestCleanup } from '../../testUtils';
import { GoalService } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-service-test-user';

registerGoalServiceTestCleanup(serverDB, userId);

describe('GoalService', () => {
  it('persists the planned recipe when the caller already chose a canary rollout', async () => {
    vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockResolvedValue({
      problemStatement: '把 50 个同构的 store 迁移到 replica',
      rollout: {
        recipeOutline: '把 store 换成 replica 支撑的实现',
        repeatable: true,
        unitCount: 50,
        units: Array.from({ length: 50 }, (_, i) => `Unit ${i + 1}`),
        variants: [{ axis: 'cold-start', values: ['yes', 'no'] }],
      },
      tasks: Array.from({ length: 5 }, (_, i) => ({
        dependsOn: [],
        instruction: `把 src/store/store${i + 1}.ts 换成 replica 实现`,
        title: `Unit ${i + 1}`,
      })),
    });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      config: { rollout: { canarySize: 3, trigger: 'canary', waveSize: 7 } },
      title: 'Migrate stores',
    });
    await service.tick(graph.goal.id);

    const policy = (await service.graph(graph.goal.id)).goal.config!.rollout!;
    // What the planner derived is kept — later waves brief from it, the gate checks its axes…
    expect(policy.spec?.recipeOutline).toBe('把 store 换成 replica 支撑的实现');
    expect(policy.spec?.variantAxes).toEqual([{ axis: 'cold-start', values: ['yes', 'no'] }]);
    expect(policy.units).toHaveLength(50);
    // …and what the caller chose still wins.
    expect(policy).toMatchObject({ canarySize: 3, trigger: 'canary', waveSize: 7 });
  });

  it('asks a blocking question before planning, then plans once with the answer', async () => {
    const planner = vi
      .spyOn(GoalCriteriaGeneratorService.prototype, 'decompose')
      .mockResolvedValue({
        assumptions: ['报告用中文'],
        problemStatement: '为新功能写一份发布说明',
        questions: [
          {
            assumption: '面向终端用户',
            blocking: true,
            impact: '决定写产品说明还是 API 变更',
            options: ['终端用户', '开发者'],
            question: '这份说明给谁看？',
          },
        ],
        tasks: [{ dependsOn: [], hypothesis: null, instruction: '写说明', title: '撰写' }],
      });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Release notes' });

    // The first plan asks instead of creating Tasks on a guess.
    expect((await service.tick(graph.goal.id)).outcome).toBe('advanced');
    let after = await service.graph(graph.goal.id);
    expect(after.nodes.filter((n) => n.kind === 'task')).toHaveLength(0);
    const problem = after.nodes.find((n) => n.kind === 'problem')!;
    expect(Number(problem.confidence)).toBe(0.3);
    expect(after.goal.config?.understanding).toMatchObject({
      assumptions: ['报告用中文'],
      level: 'low',
    });
    const [decision] = after.decisions;
    expect(decision).toMatchObject({ question: '这份说明给谁看？', status: 'pending' });
    expect(decision.options?.map((option) => option.id)).toEqual([
      'option-1',
      'option-2',
      'assume',
      'answer',
    ]);
    expect(after.edges).toContainEqual(
      expect.objectContaining({
        kind: 'leads_to',
        sourceNodeId: problem.id,
        targetNodeId: decision.nodeId,
      }),
    );

    // The open question parks the goal on the ordinary decision gate.
    expect((await service.tick(graph.goal.id)).outcome).toBe('waiting_human');
    expect((await service.graph(graph.goal.id)).goal.status).toBe('review');

    // An empty free-text answer is refused rather than re-planning on nothing.
    await expect(service.decide(graph.goal.id, decision.id, 'answer', '  ')).rejects.toThrow(
      'This answer needs a note',
    );
    await service.decide(graph.goal.id, decision.id, 'option-2', '只关心 SDK');

    // The re-plan receives the answer and, even though the planner still
    // reports a blocking question, proceeds on assumptions: one round only.
    expect((await service.tick(graph.goal.id)).outcome).toBe('advanced');
    expect(planner.mock.lastCall?.[0]).toMatchObject({
      clarifications: [{ answer: '开发者 (只关心 SDK)', question: '这份说明给谁看？' }],
      requirement: expect.any(String),
    });
    after = await service.graph(graph.goal.id);
    expect(after.nodes.filter((n) => n.kind === 'task').map((n) => n.title)).toEqual(['撰写']);
    expect(after.decisions.filter((d) => d.status === 'pending')).toHaveLength(0);
    expect(Number(after.nodes.find((n) => n.kind === 'problem')!.confidence)).toBe(0.6);
    // The re-asked question was answered, so its fallback never becomes an
    // assumption that contradicts the answer.
    expect(after.goal.config?.understanding).toMatchObject({
      assumptions: ['报告用中文'],
      level: 'medium',
    });
  });

  it('lists a clarification round for other surfaces and answers it in one go', async () => {
    const planner = vi
      .spyOn(GoalCriteriaGeneratorService.prototype, 'decompose')
      .mockResolvedValue({
        assumptions: [],
        problemStatement: '写发布说明',
        questions: [
          {
            assumption: '终端用户',
            blocking: true,
            impact: '决定语气',
            options: ['终端用户', '开发者'],
            question: '给谁看？',
          },
          { assumption: '更新日志', blocking: true, options: [], question: '发在哪里？' },
        ],
        tasks: [{ dependsOn: [], hypothesis: null, instruction: '写', title: '撰写' }],
      });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      requirement: '为新功能写一份发布说明',
      title: 'Release notes',
    });
    await service.tick(graph.goal.id);

    const pending = await service.pendingClarifications();
    expect(pending).toEqual([
      expect.objectContaining({
        goalId: graph.goal.id,
        questions: expect.arrayContaining([
          expect.objectContaining({ description: '决定语气', question: '给谁看？' }),
          expect.objectContaining({ description: null, question: '发在哪里？' }),
        ]),
        // The requirement says which goal this is away from its own page.
        requirement: '为新功能写一份发布说明',
        title: 'Release notes',
      }),
    ]);

    // A paused goal keeps its questions but stops asking them elsewhere.
    await service.pause(graph.goal.id);
    expect(await service.pendingClarifications()).toEqual([]);
    await service.resume(graph.goal.id);
    expect(await service.pendingClarifications()).toHaveLength(1);

    const audience = pending[0].questions.find((q) => q.question === '给谁看？')!;
    const place = pending[0].questions.find((q) => q.question === '发在哪里？')!;
    await service.answerClarifications(graph.goal.id, [
      { decisionId: audience.decisionId, optionId: 'option-2', resolution: '只关心 SDK' },
      { decisionId: place.decisionId, optionId: 'answer', resolution: 'GitHub Release' },
    ]);

    expect(await service.pendingClarifications()).toEqual([]);
    expect((await service.graph(graph.goal.id)).goal.status).toBe('running');
    // One re-plan, carrying both answers.
    await service.tick(graph.goal.id);
    const [lastCall] = planner.mock.calls.at(-1)!;
    expect(lastCall.clarifications).toHaveLength(2);
    expect(lastCall.clarifications).toEqual(
      expect.arrayContaining([
        { answer: '开发者 (只关心 SDK)', question: '给谁看？' },
        { answer: 'GitHub Release', question: '发在哪里？' },
      ]),
    );
  });

  it('writes none of a clarification round when one answer is invalid, and retries cleanly', async () => {
    vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockResolvedValue({
      assumptions: [],
      problemStatement: '写发布说明',
      questions: [
        {
          assumption: '终端用户',
          blocking: true,
          options: ['终端用户', '开发者'],
          question: '给谁看？',
        },
        { assumption: '更新日志', blocking: true, options: [], question: '发在哪里？' },
      ],
      tasks: [{ dependsOn: [], hypothesis: null, instruction: '写', title: '撰写' }],
    });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Release notes' });
    await service.tick(graph.goal.id);
    const [{ questions }] = await service.pendingClarifications();
    const audience = questions.find((q) => q.question === '给谁看？')!;
    const place = questions.find((q) => q.question === '发在哪里？')!;

    // The second answer is invalid, so the first must not be written either.
    await expect(
      service.answerClarifications(graph.goal.id, [
        { decisionId: audience.decisionId, optionId: 'option-2' },
        { decisionId: place.decisionId, optionId: 'no-such-option' },
      ]),
    ).rejects.toThrow('Unknown decision option');
    expect((await service.pendingClarifications())[0].questions).toHaveLength(2);

    // A retry after a partial write succeeds: the recorded answer is skipped.
    await service.decide(graph.goal.id, audience.decisionId, 'option-2');
    await service.answerClarifications(graph.goal.id, [
      { decisionId: audience.decisionId, optionId: 'option-2' },
      { decisionId: place.decisionId, optionId: 'assume' },
    ]);
    expect(await service.pendingClarifications()).toEqual([]);
  });

  it('keeps the answers in the fallback task when the re-plan fails', async () => {
    const planner = vi
      .spyOn(GoalCriteriaGeneratorService.prototype, 'decompose')
      .mockResolvedValue({
        assumptions: [],
        problemStatement: '写发布说明',
        questions: [
          {
            assumption: '终端用户',
            blocking: true,
            options: ['终端用户', '开发者'],
            question: '给谁看？',
          },
        ],
        tasks: [{ dependsOn: [], hypothesis: null, instruction: '写', title: '撰写' }],
      });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      problemDescription: '写一份发布说明，必须附上迁移指南',
      requirement: '写一份发布说明，必须附上迁移指南',
      title: 'Release notes',
    });
    await service.tick(graph.goal.id);
    // Asking commits no tasks, so the user's own words stay on the problem.
    expect(
      (await service.graph(graph.goal.id)).nodes.find((n) => n.kind === 'problem')!.description,
    ).toBe('写一份发布说明，必须附上迁移指南');
    const [{ questions }] = await service.pendingClarifications();
    await service.answerClarifications(graph.goal.id, [
      { decisionId: questions[0].decisionId, optionId: 'option-2', resolution: '只关心 SDK' },
    ]);

    planner.mockRejectedValueOnce(new Error('planner down'));
    await service.tick(graph.goal.id);

    const task = (await service.graph(graph.goal.id)).nodes.find((n) => n.kind === 'task');
    // The original request's constraint survives, not the planner's summary.
    expect(task!.description).toContain('必须附上迁移指南');
    expect(task!.description).toContain('Q: 给谁看？');
    expect(task!.description).toContain('A: 开发者 (只关心 SDK)');
  });

  it('keeps the coordinator understanding when the user edits the goal policy', async () => {
    vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockResolvedValue({
      assumptions: ['只修 P0'],
      problemStatement: '修 bug',
      questions: [],
      tasks: [{ dependsOn: [], hypothesis: null, instruction: '修', title: '修复' }],
    });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Fix' });
    await service.tick(graph.goal.id);

    // A policy editor sends its whole (stale) config snapshot back.
    await new GoalModel(serverDB, userId).update(graph.goal.id, {
      config: { maxConcurrentTasks: 2 },
    });

    const after = await service.graph(graph.goal.id);
    expect(after.goal.config?.maxConcurrentTasks).toBe(2);
    expect(after.goal.config?.understanding).toMatchObject({
      assumptions: ['只修 P0'],
      level: 'medium',
    });
  });
});
