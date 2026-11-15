// @vitest-environment node
import { GOAL_ACCEPTANCE_TASK_TITLE } from '@lobechat/const/goal';
import { describe, expect, it } from 'vitest';

import { buildSharedGoalView, type SharedGoalAcceptanceInput } from './sharedGoalView';

const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute));

const node = (id: string, minute: number, extra: Record<string, unknown> = {}) => ({
  confidence: null,
  createdAt: at(minute),
  createdByAgentId: 'agt_secret',
  createdByUserId: 'user_secret',
  description: 'internal description',
  goalId: 'goal_1',
  id,
  kind: 'task',
  priority: 1,
  resolvedAt: null,
  status: 'resolved',
  taskId: `task_for_${id}`,
  title: `Step ${id.length}`,
  updatedAt: at(minute),
  ...extra,
});

const edge = (id: string, source: string, target: string, kind = 'depends_on') => ({
  createdAt: at(0),
  goalId: 'goal_1',
  id,
  kind,
  sourceNodeId: source,
  targetNodeId: target,
});

const accepted: SharedGoalAcceptanceInput = {
  checks: [
    { passed: true, state: 'passed', summary: 'Looks right', title: 'Report renders' },
    { passed: false, state: 'failed', summary: null, title: 'Graph is drawn' },
  ],
  status: 'accepted',
};

const buildGraph = () =>
  ({
    acceptances: { node_a: { id: 'acc_secret', status: 'accepted' } },
    assignees: { node_a: 'agt_assignee' },
    decisions: [{ id: 'dec_1', question: 'secret decision', requestedUserId: 'user_x' }],
    edges: [edge('edge_1', 'node_b', 'node_a'), edge('edge_2', 'node_a', 'node_zzz')],
    events: [{ id: 'evt_1', operationId: 'op_secret', taskId: 'task_x' }],
    goal: {
      config: { budget: { maxCost: 99 } },
      id: 'goal_1',
      requirement: 'Ship the thing',
      spendLimit: 12,
      status: 'achieved',
      title: 'My goal',
      topicId: 'tpc_secret',
      userId: 'user_owner',
    },
    nodes: [
      node('node_b', 2),
      node('node_a', 1),
      node('node_acc', 3, { title: GOAL_ACCEPTANCE_TASK_TITLE }),
    ],
    report: {
      dispatch: { acceptanceKey: 'k', dispatchedAt: 'x', nodeId: 'node_a', operationId: 'op_leak' },
      latest: {
        content: 'markdown body',
        createdAt: at(5),
        metadata: {
          chapters: [
            {
              detours: [
                {
                  kind: 'dead_end',
                  lesson: 'lesson',
                  nodeIds: ['node_b', 'node_unknown'],
                  reason: 'reason',
                  title: 'detour',
                },
              ],
              findingIds: ['node_b'],
              narrative: 'It went well',
              nodeIds: ['node_a', 'node_unknown'],
              title: 'Chapter 1',
              workVersionIds: ['wv_secret'],
            },
          ],
          deliverableWorkId: 'work_1',
          graphCursor: 'evt_cursor_secret',
          headline: 'Done',
          mainline: { edgeIds: ['edge_1', 'edge_missing'], nodeIds: ['node_a', 'node_b'] },
          nextSteps: [{ nodeIds: ['node_b'], reason: 'because', title: 'Next' }],
        },
        pageDocumentId: 'docs_secret',
        version: 3,
        workId: 'work_internal',
        workVersionId: 'wv_internal',
      },
      status: 'completed',
    },
    runHeartbeats: { node_a: at(9) },
    spend: { byTask: [], runs: 4, totalCost: 3.5, totalTokens: 1000 },
    workVersions: [],
  }) as any;

describe('buildSharedGoalView', () => {
  const nodeAcceptanceIds = { node_a: 'acc_secret', node_acc: 'acc_goal' };
  const acceptances = { acc_goal: accepted, acc_secret: accepted };

  it('keeps title, requirement and status of the goal', () => {
    const view = buildSharedGoalView(buildGraph(), acceptances, nodeAcceptanceIds);

    expect(view.goal).toEqual({
      requirement: 'Ship the thing',
      status: 'achieved',
      title: 'My goal',
    });
  });

  it('never carries any forbidden field or internal id, at any depth', () => {
    const view = buildSharedGoalView(buildGraph(), acceptances, nodeAcceptanceIds);
    const json = JSON.stringify(view);

    for (const forbidden of [
      'userId',
      'createdByUserId',
      'createdByAgentId',
      'cost',
      'Cost',
      'budget',
      'spend',
      'config',
      'events',
      'decisions',
      'assignees',
      'runHeartbeats',
      'taskId',
      'topicId',
      'operationId',
      'graphCursor',
      'workVersionId',
      'pageDocumentId',
      'description',
    ]) {
      expect(json, forbidden).not.toContain(`"${forbidden}"`);
    }
    for (const leaked of [
      'user_owner',
      'user_secret',
      'agt_secret',
      'agt_assignee',
      'tpc_secret',
      'op_leak',
      'op_secret',
      'task_for_',
      'acc_secret',
      'wv_secret',
      'wv_internal',
      'work_internal',
      'docs_secret',
      'evt_cursor_secret',
      'secret decision',
      'node_a',
      'edge_1',
    ]) {
      expect(json, leaked).not.toContain(leaked);
    }
  });

  it('exposes only kind / title / status / dependencies on graph nodes', () => {
    const view = buildSharedGoalView(buildGraph(), acceptances, nodeAcceptanceIds);

    expect(view.nodes.map((n) => Object.keys(n).sort())).toEqual([
      ['acceptance', 'dependsOn', 'id', 'kind', 'status', 'title'],
      ['dependsOn', 'id', 'kind', 'status', 'title'],
      ['acceptance', 'dependsOn', 'id', 'kind', 'status', 'title'],
    ]);
    // node_b depends on node_a; ids are view-local, ordered by creation.
    expect(view.nodes.map((n) => [n.id, n.dependsOn])).toEqual([
      ['n1', []],
      ['n2', ['n1']],
      ['n3', []],
    ]);
  });

  it('drops edges that leave the shared graph and remaps the rest', () => {
    const view = buildSharedGoalView(buildGraph(), acceptances, nodeAcceptanceIds);

    expect(view.edges).toEqual([{ from: 'n2', id: 'e1', kind: 'depends_on', to: 'n1' }]);
  });

  it('keeps the report narrative with mainline references remapped', () => {
    const { report } = buildSharedGoalView(buildGraph(), acceptances, nodeAcceptanceIds);

    expect(report).toMatchObject({
      deliverableWorkId: 'work_1',
      headline: 'Done',
      mainline: { edgeIds: ['e1'], nodeIds: ['n1', 'n2'] },
      nextSteps: [{ nodeIds: ['n2'], reason: 'because', title: 'Next' }],
    });
    expect(report?.chapters[0]).toMatchObject({
      findingIds: ['n2'],
      narrative: 'It went well',
      nodeIds: ['n1'],
      title: 'Chapter 1',
    });
    expect(report?.chapters[0]?.detours[0]?.nodeIds).toEqual(['n2']);
  });

  it('returns per-node and Goal-level Acceptance with criterion, verdict and summary', () => {
    const view = buildSharedGoalView(buildGraph(), acceptances, nodeAcceptanceIds);

    expect(view.nodes[0]?.acceptance).toEqual(accepted);
    expect(view.nodes[1]?.acceptance).toBeUndefined();
    expect(view.acceptance).toEqual(accepted);
  });

  it('never copies fields the acceptance reader attached beyond the allow-list', () => {
    const leaky = {
      checks: [{ passed: true, resultId: 'res_secret', state: 'passed', summary: 's', title: 't' }],
      id: 'acc_secret',
      status: 'accepted',
      userId: 'user_owner',
    } as unknown as SharedGoalAcceptanceInput;
    const view = buildSharedGoalView(buildGraph(), { acc_goal: leaky }, nodeAcceptanceIds);
    const json = JSON.stringify(view);

    expect(json).not.toContain('res_secret');
    expect(json).not.toContain('user_owner');
    expect(view.acceptance).toEqual({
      checks: [{ passed: true, state: 'passed', summary: 's', title: 't' }],
      status: 'accepted',
    });
  });

  it('has no report or Goal acceptance when none exists', () => {
    const graph = buildGraph();
    graph.report = undefined;
    const view = buildSharedGoalView(graph, {}, {});

    expect(view.report).toBeNull();
    expect(view.acceptance).toBeNull();
  });
});
