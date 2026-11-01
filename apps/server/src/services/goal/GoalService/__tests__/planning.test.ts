// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { goalEvents } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { GoalCriteriaGeneratorService } from '../../criteriaGenerator';
import { registerGoalServiceTestCleanup } from '../../testUtils';
import { GoalService } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-service-test-user';

registerGoalServiceTestCleanup(serverDB, userId);

describe('GoalService', () => {
  it('attaches seed tasks straight to the problem instead of wrapping each in an experiment', async () => {
    // An experiment is a candidate answer under test. A caller-supplied seed is
    // ordinary work, so it takes the same shape as a planned or manager-submitted
    // Task: a `decomposes` edge from the problem, no answer container.
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Question', tasks: ['Seed work'] });
    const question = graph.nodes.find((n) => n.kind === 'problem')!;
    const task = graph.nodes.find((n) => n.kind === 'task')!;
    expect(graph.goal.config?.exploration).toBeUndefined();
    expect(graph.nodes.filter((n) => n.kind === 'experiment')).toHaveLength(0);
    expect(graph.edges).toEqual([
      expect.objectContaining({
        kind: 'decomposes',
        sourceNodeId: question.id,
        targetNodeId: task.id,
      }),
    ]);
  });

  it('seeds the exploration baseline inside an experiment container', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      config: { exploration: { instruction: 'Compare evidence', maxExperiments: 3 } },
      title: 'Explore',
    });
    const question = graph.nodes.find((n) => n.kind === 'problem')!;
    const answer = graph.nodes.find((n) => n.kind === 'experiment')!;
    const task = graph.nodes.find((n) => n.kind === 'task')!;
    expect(answer.taskId).toBeNull();
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'answers',
          sourceNodeId: answer.id,
          targetNodeId: question.id,
        }),
        expect.objectContaining({
          kind: 'contains',
          sourceNodeId: answer.id,
          targetNodeId: task.id,
        }),
      ]),
    );
  });

  it('plans the decomposition when a goal has no tasks yet', async () => {
    vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockResolvedValue({
      problemStatement: '核心问题的一句话陈述',
      tasks: [
        { dependsOn: [], hypothesis: null, instruction: '收集原始材料', title: '方向A:收集' },
        {
          dependsOn: [0],
          hypothesis: '按模块聚类比按时间排序更能暴露根因',
          instruction: '分析并综合结论',
          title: '方向B:分析',
        },
        // Self and forward references are planner hallucinations — dropped.
        { dependsOn: [1, 2, 9], instruction: '汇编最终报告', title: '方向C:汇编' },
      ],
    });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      problemDescription: '用户的原话',
      requirement: '完整需求与验收标准全文',
      title: 'Complex ask',
    });
    // The seeded graph carries the user's own words, not the contract blob.
    expect(graph.nodes.find((n) => n.kind === 'problem')?.description).toBe('用户的原话');
    expect(graph.nodes.filter((n) => n.kind === 'task')).toHaveLength(0);

    const result = await service.tick(graph.goal.id);

    expect(result.outcome).toBe('advanced');
    const after = await service.graph(graph.goal.id);
    expect(after.nodes.filter((n) => n.kind === 'task').map((n) => n.title)).toEqual([
      '方向A:收集',
      '方向B:分析',
      '方向C:汇编',
    ]);
    const problem = after.nodes.find((n) => n.kind === 'problem')!;
    expect(problem.description).toBe('核心问题的一句话陈述');

    // Only the direction the planner marked as a hypothesis becomes a candidate
    // answer: one experiment answering the problem and containing that Task.
    // The certain steps attach straight to the problem.
    const byTitle = new Map(after.nodes.map((n) => [n.title, n.id]));
    const experiments = after.nodes.filter((n) => n.kind === 'experiment');
    expect(experiments).toHaveLength(1);
    expect(experiments[0]).toMatchObject({
      description: '按模块聚类比按时间排序更能暴露根因',
      title: '方向B:分析',
    });
    expect(after.edges.filter((e) => e.kind === 'answers')).toEqual([
      expect.objectContaining({ sourceNodeId: experiments[0].id, targetNodeId: problem.id }),
    ]);
    expect(after.edges.filter((e) => e.kind === 'contains')).toEqual([
      expect.objectContaining({
        sourceNodeId: experiments[0].id,
        targetNodeId: byTitle.get('方向B:分析'),
      }),
    ]);
    expect(
      after.edges
        .filter((e) => e.kind === 'decomposes' && e.sourceNodeId === problem.id)
        .map((e) => e.targetNodeId)
        .sort(),
    ).toEqual([byTitle.get('方向A:收集'), byTitle.get('方向C:汇编')].sort());

    // The planner's dependsOn indices become depends_on edges, dependent →
    // prerequisite; the self and forward references were dropped.
    const deps = after.edges
      .filter((e) => e.kind === 'depends_on')
      .map((e) => [e.sourceNodeId, e.targetNodeId]);
    expect(deps).toHaveLength(2);
    expect(deps).toEqual(
      expect.arrayContaining([
        [byTitle.get('方向B:分析'), byTitle.get('方向A:收集')],
        [byTitle.get('方向C:汇编'), byTitle.get('方向B:分析')],
      ]),
    );
  });

  it('plans a goal without hypotheses as plain tasks under the problem', async () => {
    vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockResolvedValue({
      problemStatement: '修好最近三天的 bug',
      tasks: [
        { dependsOn: [], hypothesis: null, instruction: '列出 issue', title: '建立清单' },
        { dependsOn: [0], hypothesis: null, instruction: '逐项修复', title: '实施修复' },
      ],
    });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Bug sweep' });

    expect((await service.tick(graph.goal.id)).outcome).toBe('advanced');

    const after = await service.graph(graph.goal.id);
    const problem = after.nodes.find((n) => n.kind === 'problem')!;
    const taskIds = after.nodes.filter((n) => n.kind === 'task').map((n) => n.id);
    expect(taskIds).toHaveLength(2);
    expect(after.nodes.filter((n) => n.kind === 'experiment')).toHaveLength(0);
    expect(after.edges.filter((e) => e.kind === 'answers' || e.kind === 'contains')).toHaveLength(
      0,
    );
    expect(
      after.edges
        .filter((e) => e.kind === 'decomposes' && e.sourceNodeId === problem.id)
        .map((e) => e.targetNodeId)
        .sort(),
    ).toEqual([...taskIds].sort());
    expect(after.edges.filter((e) => e.kind === 'depends_on')).toHaveLength(1);
  });

  it('collapses a repeated mould into one batch, materializing only the probes', async () => {
    vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockResolvedValue({
      problemStatement: '把 50 个同构的 store 迁移到 replica',
      rollout: {
        recipeOutline: '把 store 换成 replica 支撑的实现',
        repeatable: true,
        unitCount: 50,
        units: Array.from({ length: 50 }, (_, i) => `Unit ${i + 1}`),
        variants: [],
      },
      tasks: Array.from({ length: 5 }, (_, i) => ({
        dependsOn: [],
        instruction: `把 src/store/store${i + 1}.ts 换成 replica 实现`,
        title: `Unit ${i + 1}`,
      })),
    });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Migrate stores' });

    expect((await service.tick(graph.goal.id)).outcome).toBe('advanced');

    const after = await service.graph(graph.goal.id);
    // ① Only the K probes exist as Tasks — the whole 50-unit fan-out never lands.
    expect(after.nodes.filter((n) => n.kind === 'task')).toHaveLength(5);
    expect(after.nodes.filter((n) => n.kind === 'batch')).toHaveLength(1);
    expect(after.nodes.filter((n) => n.kind === 'finding')).toHaveLength(1);
    expect(after.nodes.filter((n) => n.kind === 'decision')).toHaveLength(1);

    const state = after.goal.config?.rolloutState;
    expect(state?.phase).toBe('probe');
    expect(state?.probeNodeIds).toHaveLength(5);
    expect(state?.unitTitles).toHaveLength(50);
    expect(after.goal.config?.rollout?.trigger).toBe('canary');

    // The probes are contained by the batch; the gate waits on each of them.
    const batch = after.nodes.find((n) => n.kind === 'batch')!;
    const containedIds = new Set(
      after.edges
        .filter((e) => e.kind === 'contains' && e.sourceNodeId === batch.id)
        .map((e) => e.targetNodeId),
    );
    // Five probes inside the batch — never the whole 50-unit roster.
    expect(after.nodes.filter((n) => containedIds.has(n.id) && n.kind === 'task')).toHaveLength(5);
    // Plus the one Template and the one Assay that make the batch a batch.
    expect(after.nodes.filter((n) => containedIds.has(n.id) && n.kind === 'finding')).toHaveLength(
      1,
    );
    expect(after.nodes.filter((n) => containedIds.has(n.id) && n.kind === 'decision')).toHaveLength(
      1,
    );
  });

  it('does not grow a batch for a goal that is not one repeated mould', async () => {
    vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockResolvedValue({
      problemStatement: '分两步上线一个新功能',
      rollout: {
        recipeOutline: '',
        repeatable: false,
        unitCount: 3,
        units: [],
        variants: [],
      },
      tasks: [
        { dependsOn: [], instruction: '第一步：加 schema', title: '第一步' },
        { dependsOn: [0], instruction: '第二步：接 UI', title: '第二步' },
      ],
    });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Ship a feature' });

    expect((await service.tick(graph.goal.id)).outcome).toBe('advanced');

    const after = await service.graph(graph.goal.id);
    expect(after.nodes.filter((n) => n.kind === 'batch')).toHaveLength(0);
    expect(after.goal.config?.rolloutState).toBeUndefined();
    // The ordinary decomposition is untouched: both steps are plain tasks.
    expect(after.nodes.filter((n) => n.kind === 'task')).toHaveLength(2);
  });

  it('keeps every roster unit when a rollout claim cannot become a batch', async () => {
    vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockResolvedValue({
      problemStatement: '把 12 个同构的 store 迁移到 replica',
      rollout: {
        recipeOutline: '把 store 换成 replica 支撑的实现',
        repeatable: true,
        unitCount: 12,
        units: Array.from({ length: 12 }, (_, i) => `Unit ${i + 1}`),
        variants: [],
      },
      tasks: Array.from({ length: 3 }, (_, i) => ({
        dependsOn: [],
        instruction: `把 src/store/store${i + 1}.ts 换成 replica 实现`,
        title: `Unit ${i + 1}`,
      })),
    });
    const service = new GoalService(serverDB, userId);
    // The caller forbade a batch, so the planner's claim must NOT drop the
    // units its probe-only `tasks` left out.
    const graph = await service.create({
      config: { rollout: { trigger: 'off' } },
      title: 'Migrate stores, no batch',
    });
    await service.tick(graph.goal.id);

    const after = await service.graph(graph.goal.id);
    expect(after.nodes.filter((n) => n.kind === 'batch')).toHaveLength(0);
    // All 12 units are planned, not only the 3 the planner listed as probes.
    expect(after.nodes.filter((n) => n.kind === 'task')).toHaveLength(12);
  });

  /**
   * Regression: a planner failure was swallowed whole — the goal quietly
   * became one task built from the raw requirement, and nothing anywhere said
   * the planner had failed or why.
   */
  it('records why the planner failed on the task it fell back to', async () => {
    vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockRejectedValue({
      error: { message: 'Insufficient Balance' },
      errorType: 'InsufficientQuota',
    });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ requirement: '迁移 12 个 store', title: 'Migrate' });
    await service.tick(graph.goal.id);

    const task = (await service.graph(graph.goal.id)).nodes.find((n) => n.kind === 'task');
    const [created] = await serverDB
      .select()
      .from(goalEvents)
      .where(and(eq(goalEvents.entityId, task.id), eq(goalEvents.eventType, 'created')));
    expect(created.reason).toBe(
      'Planner failed (InsufficientQuota: Insufficient Balance); no main Agent could take the goal; started from the raw requirement',
    );
  });

  it('records why a batch claim was refused on the first task it planned instead', async () => {
    vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockResolvedValue({
      problemStatement: '把 8 个 store 迁移到 replica',
      rollout: {
        recipeOutline: '把 store 换成 replica 支撑的实现',
        repeatable: true,
        unitCount: 8,
        units: Array.from({ length: 8 }, (_, i) => `Unit ${i + 1}`),
        variants: [],
      },
      tasks: Array.from({ length: 3 }, (_, i) => ({
        dependsOn: [],
        instruction: `把 src/store/store${i + 1}.ts 换成 replica 实现`,
        title: `Unit ${i + 1}`,
      })),
    });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Migrate 8 stores' });
    await service.tick(graph.goal.id);

    const tasks = (await service.graph(graph.goal.id)).nodes.filter((n) => n.kind === 'task');
    const reasons = await serverDB
      .select({ entityId: goalEvents.entityId, reason: goalEvents.reason })
      .from(goalEvents)
      .where(eq(goalEvents.eventType, 'created'));
    const reasonOf = (id: string) => reasons.find((event) => event.entityId === id)?.reason;
    expect(reasonOf(tasks[0].id)).toBe(
      'Batch claim refused (unitCount 8 is below the threshold 10); planned unit by unit',
    );
    // Said once, not on every task.
    expect(reasonOf(tasks[1].id)).toBeNull();
  });
});
