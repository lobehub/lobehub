import { GOAL_ACCEPTANCE_TASK_TITLE, GOAL_REPORT_TASK_TITLE } from '@lobechat/const/goal';
import type {
  GoalGraphDecision,
  GoalGraphEdge,
  GoalGraphNode,
  GoalGraphSnapshot,
  GoalReportMetadata,
  TaskItem,
} from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { decideNextMove, selectFrontier } from './decideNextMove';
import {
  buildGoalReportInstruction,
  buildGoalReportSkeleton,
  decideGoalReport,
  validateGoalReport,
} from './report';

const node = (id: string, overrides: Partial<GoalGraphNode> = {}): GoalGraphNode =>
  ({
    createdAt: new Date(1000),
    description: null,
    id,
    kind: 'task',
    priority: 0,
    resolvedAt: null,
    status: 'proposed',
    taskId: null,
    title: id,
    updatedAt: new Date(1000),
    ...overrides,
  }) as GoalGraphNode;

const edge = (
  sourceNodeId: string,
  kind: GoalGraphEdge['kind'],
  targetNodeId: string,
): GoalGraphEdge =>
  ({
    createdAt: new Date(1000),
    id: `${sourceNodeId}-${kind}-${targetNodeId}`,
    kind,
    sourceNodeId,
    targetNodeId,
  }) as GoalGraphEdge;

const gate = (id: string, nodeId: string, overrides: Partial<GoalGraphDecision> = {}) =>
  ({
    createdAt: new Date(5000),
    id,
    nodeId,
    question: 'Retry Goal acceptance or fail this Goal?',
    resolvedOptionId: null,
    status: 'pending',
    ...overrides,
  }) as GoalGraphDecision;

const graph = (overrides: Partial<GoalGraphSnapshot> = {}): GoalGraphSnapshot =>
  ({
    decisions: [],
    edges: [],
    events: [],
    goal: {
      config: {},
      id: 'goal_1',
      requirement: 'Ship it',
      status: 'running',
      title: 'G',
      updatedAt: new Date(1000),
    },
    nodes: [],
    workVersions: [],
    ...overrides,
  }) as GoalGraphSnapshot;

const acceptance = (overrides: Partial<GoalGraphNode> = {}) =>
  node('acc', { title: GOAL_ACCEPTANCE_TASK_TITLE, ...overrides });

describe('decideGoalReport', () => {
  it('does not dispatch while Goal-level acceptance has not ended', () => {
    for (const status of ['proposed', 'active', 'waiting'] as const) {
      expect(
        decideGoalReport(
          graph({ nodes: [node('t1', { status: 'resolved' }), acceptance({ status })] }),
        ),
      ).toEqual({ dispatch: false, reason: 'Goal-level acceptance has not ended' });
    }
    // Every Task resolved but acceptance not even created yet.
    expect(decideGoalReport(graph({ nodes: [node('t1', { status: 'resolved' })] })).dispatch).toBe(
      false,
    );
  });

  it('does not dispatch on a verification failure that still has attempts left', () => {
    // A rejection with attempts left is retried automatically: no gate, node stays active.
    const snapshot = graph({ nodes: [acceptance({ status: 'active' })] });
    expect(decideGoalReport(snapshot).dispatch).toBe(false);
  });

  it('dispatches once when acceptance passed', () => {
    const resolvedAt = new Date(7000);
    const snapshot = graph({
      goal: { ...graph().goal, status: 'achieved' },
      nodes: [node('t1', { status: 'resolved' }), acceptance({ resolvedAt, status: 'resolved' })],
    });
    const first = decideGoalReport(snapshot);
    expect(first).toEqual({
      dispatch: true,
      key: `accepted:acc:${resolvedAt.getTime()}`,
      trigger: 'accepted',
    });

    const dispatched = graph({
      ...snapshot,
      goal: {
        ...snapshot.goal,
        config: {
          report: {
            acceptanceKey: (first as { key: string }).key,
            dispatchedAt: new Date().toISOString(),
            nodeId: 'report',
            trigger: 'accepted',
          },
        },
      },
    });
    expect(decideGoalReport(dispatched).dispatch).toBe(false);
  });

  it('dispatches again when changes were requested and acceptance passed again', () => {
    const snapshot = graph({
      goal: {
        ...graph().goal,
        config: {
          report: {
            acceptanceKey: 'accepted:acc:7000',
            dispatchedAt: new Date().toISOString(),
            nodeId: 'report',
            trigger: 'accepted',
          },
        },
        status: 'achieved',
      },
      nodes: [acceptance({ resolvedAt: new Date(9000), status: 'resolved' })],
    });
    expect(decideGoalReport(snapshot)).toMatchObject({
      dispatch: true,
      key: 'accepted:acc:9000',
    });
  });

  it('does not treat a resolved acceptance as ended while new work is open', () => {
    const snapshot = graph({
      nodes: [acceptance({ status: 'resolved' }), node('fix', { status: 'active' })],
    });
    expect(decideGoalReport(snapshot).dispatch).toBe(false);
  });

  it('dispatches once when acceptance failed with its attempts spent', () => {
    const snapshot = graph({
      decisions: [gate('gate_1', 'decision')],
      edges: [edge('acc', 'leads_to', 'decision')],
      goal: { ...graph().goal, status: 'review' },
      nodes: [acceptance({ status: 'waiting' }), node('decision', { kind: 'decision' })],
    });
    expect(decideGoalReport(snapshot)).toEqual({
      dispatch: true,
      key: 'acceptance_failed:gate_1',
      trigger: 'acceptance_failed',
    });

    // Answering the gate with `fail` ends the Goal, but it is the same result.
    const failed = graph({
      ...snapshot,
      decisions: [gate('gate_1', 'decision', { resolvedOptionId: 'fail', status: 'resolved' })],
      goal: {
        ...snapshot.goal,
        config: {
          report: {
            acceptanceKey: 'acceptance_failed:gate_1',
            dispatchedAt: new Date().toISOString(),
            nodeId: 'report',
            trigger: 'acceptance_failed',
          },
        },
        status: 'failed',
      },
      nodes: [acceptance({ status: 'retired' }), node('decision', { kind: 'decision' })],
    });
    expect(decideGoalReport(failed).dispatch).toBe(false);

    // Answering it with `retry` puts acceptance back in progress: nothing to report.
    const retried = graph({
      ...snapshot,
      decisions: [gate('gate_1', 'decision', { resolvedOptionId: 'retry', status: 'resolved' })],
      goal: { ...snapshot.goal, status: 'running' },
      nodes: [acceptance({ status: 'active' }), node('decision', { kind: 'decision' })],
    });
    expect(decideGoalReport(retried).dispatch).toBe(false);
  });

  it('dispatches once when the Goal is failed or canceled', () => {
    for (const status of ['failed', 'canceled'] as const) {
      const snapshot = graph({
        events: [
          {
            createdAt: new Date(8000),
            entityId: 'goal_1',
            entityType: 'goal',
            eventType: 'rejected',
            id: `evt_${status}`,
          } as GoalGraphSnapshot['events'][number],
        ],
        goal: { ...graph().goal, status },
        nodes: [node('t1', { status: 'active' })],
      });
      const decision = decideGoalReport(snapshot);
      expect(decision).toEqual({
        dispatch: true,
        key: `goal_${status}:evt_${status}`,
        trigger: status === 'failed' ? 'goal_failed' : 'goal_canceled',
      });
      expect(
        decideGoalReport(
          graph({
            ...snapshot,
            goal: {
              ...snapshot.goal,
              config: {
                report: {
                  acceptanceKey: (decision as { key: string }).key,
                  dispatchedAt: new Date().toISOString(),
                  nodeId: 'report',
                  trigger: 'goal_failed',
                },
              },
            },
          }),
        ).dispatch,
      ).toBe(false);
    }
  });
});

describe('the wrap-up node does not take part in the Goal status', () => {
  const reportNode = node('report', {
    status: 'active',
    taskId: 'task_report',
    title: GOAL_REPORT_TASK_TITLE,
  });

  it('a failed wrap-up Task opens no gate and does not block acceptance', () => {
    const snapshot = graph({
      nodes: [node('t1', { status: 'resolved' }), reportNode],
    });
    const move = decideNextMove({
      concurrency: 1,
      frontier: selectFrontier(snapshot),
      graph: snapshot,
      tasksById: new Map([
        [
          'task_report',
          { error: 'boom', id: 'task_report', identifier: 'T-9', status: 'paused' } as TaskItem,
        ],
      ]),
    });
    expect(move.branch).toBe('terminal_acceptance');
    expect(move.outcome).toBe('advanced');
  });

  it('a running wrap-up Task holds no concurrency slot and never becomes the frontier', () => {
    const snapshot = graph({ nodes: [node('t1'), reportNode] });
    const frontier = selectFrontier(snapshot);
    expect(frontier.candidates.map((candidate) => candidate.nodeId)).toEqual(['t1']);
    const move = decideNextMove({
      concurrency: 1,
      frontier,
      graph: snapshot,
      tasksById: new Map([
        ['task_report', { id: 'task_report', identifier: 'T-9', status: 'running' } as TaskItem],
      ]),
    });
    expect(move).toMatchObject({ branch: 'create_task', chosenNodeId: 't1' });
  });
});

describe('buildGoalReportSkeleton', () => {
  // problem → t1 (resolved) → t2 (resolved, depends on t1) → acc (depends on t2)
  // t1b: an earlier protocol revised by t2; t0: a retired direction off t1.
  const snapshot = graph({
    edges: [
      edge('t2', 'depends_on', 't1'),
      edge('acc', 'depends_on', 't2'),
      edge('t1', 'produces', 'f1'),
      edge('t2', 'produces', 'f2'),
      edge('t2', 'revises', 't1b'),
      edge('t0', 'depends_on', 't1'),
    ],
    events: [
      { createdAt: new Date(1), id: 'evt_old' },
      { createdAt: new Date(9), id: 'evt_new' },
    ] as GoalGraphSnapshot['events'],
    nodes: [
      node('problem', { kind: 'problem', status: 'resolved' }),
      node('t1', { createdAt: new Date(1), status: 'resolved' }),
      node('f1', { kind: 'finding', status: 'resolved' }),
      node('t1b', { createdAt: new Date(2), status: 'resolved' }),
      node('t0', { createdAt: new Date(3), status: 'retired' }),
      node('t2', { createdAt: new Date(4), status: 'resolved' }),
      node('f2', { kind: 'finding', status: 'resolved' }),
      acceptance({ createdAt: new Date(5), status: 'resolved' }),
      node('report', { title: GOAL_REPORT_TASK_TITLE }),
    ],
    workVersions: [
      {
        createdAt: new Date(6),
        id: 'l1',
        nodeId: 't2',
        relation: 'produced',
        work: { title: 'Final doc', type: 'document', workId: 'work_doc' },
        workVersionId: 'wv_doc',
      },
    ] as GoalGraphSnapshot['workVersions'],
  });

  it('traces the main path back from the deliverable and hangs detours under their fork', () => {
    const skeleton = buildGoalReportSkeleton(snapshot);
    expect(skeleton.mainPath.map((item) => item.id)).toEqual(['t1', 't2', 'acc']);
    expect(skeleton.mainPath.find((item) => item.id === 't2')).toMatchObject({
      findingIds: ['f2'],
      workVersionIds: ['wv_doc'],
    });
    expect(skeleton.detours).toEqual([
      expect.objectContaining({
        forkNodeId: 't2',
        id: 't1b',
        signal: 'superseded by t2 (revises)',
      }),
      expect.objectContaining({ forkNodeId: 't1', id: 't0', signal: 'retired' }),
    ]);
    expect(skeleton.deliverable).toMatchObject({ workId: 'work_doc', workVersionId: 'wv_doc' });
    expect(skeleton.graphCursor).toBe('evt_new');
    // The candidate mainline stops at the path: detours and the wrap-up node stay off it.
    expect(skeleton.mainline.nodeIds).toEqual(['problem', 't1', 'f1', 't2', 'f2', 'acc']);
    expect(skeleton.mainline.edges.map((item) => item.id)).toEqual([
      't2-depends_on-t1',
      'acc-depends_on-t2',
      't1-produces-f1',
      't2-produces-f2',
    ]);
  });

  it('asks for chapters, detour reasons and lessons, next steps and a submission', () => {
    const text = buildGoalReportInstruction(
      snapshot,
      'accepted',
      'lobe-goal-report.submitGoalReport',
    );
    expect(text).toContain('Candidate main path');
    expect(text).toContain('t1b [task, resolved] t1b · superseded by t2 (revises) · fork: t2');
    expect(text).toContain('Goal-level acceptance passed');
    expect(text).toContain('Graph cursor: evt_new');
    expect(text).toContain('Call lobe-goal-report.submitGoalReport once');
    expect(text).toContain('reason it was abandoned and the lesson');
    expect(text).not.toContain('report [task');
    expect(text).toContain('Candidate mainline');
    expect(text).toContain('- edge t2-depends_on-t1: t2 -[depends_on]-> t1');
    expect(text).toContain('Mark the mainline');
    expect(text).toContain('headline, deliverableWorkId, chapters, mainline, nextSteps');
  });

  describe('validateGoalReport', () => {
    const valid: GoalReportMetadata = {
      chapters: [
        {
          detours: [
            { kind: 'superseded', lesson: 'L', nodeIds: ['t1b'], reason: 'R', title: 'Old' },
            { kind: 'dead_end', lesson: 'L', nodeIds: ['t0'], reason: 'R', title: 'Dead' },
          ],
          findingIds: ['f1', 'f2'],
          narrative: 'N',
          nodeIds: ['t1', 't2'],
          title: 'C1',
          workVersionIds: ['wv_doc'],
        },
        {
          detours: [],
          findingIds: [],
          narrative: 'N',
          nodeIds: ['acc'],
          title: 'C2',
          workVersionIds: [],
        },
      ],
      deliverableWorkId: 'work_doc',
      graphCursor: 'evt_new',
      headline: 'H',
      mainline: {
        edgeIds: ['t2-depends_on-t1', 'acc-depends_on-t2', 't2-produces-f2'],
        nodeIds: ['problem', 't1', 't2', 'f2', 'acc'],
      },
      nextSteps: [{ nodeIds: ['t2'], reason: 'R', title: 'Next' }],
    };

    it('accepts references that belong to the Goal', () => {
      expect(
        validateGoalReport(snapshot, valid, { eventIds: new Set(['evt_old', 'evt_new']) }),
      ).toEqual([]);
    });

    it('rejects foreign ids, unresolved main-path nodes and fake detours', () => {
      const errors = validateGoalReport(
        snapshot,
        {
          ...valid,
          chapters: [
            {
              ...valid.chapters[0],
              detours: [
                { kind: 'dead_end', lesson: 'L', nodeIds: ['t2'], reason: 'R', title: 'Not dead' },
              ],
              findingIds: ['t1', 'f_other'],
              nodeIds: ['t0', 'n_other', 'report'],
              workVersionIds: ['wv_other'],
            },
          ],
          deliverableWorkId: 'work_other',
          graphCursor: 'evt_other',
          nextSteps: [{ nodeIds: ['n_other'], reason: 'R', title: 'Next' }],
        },
        { eventIds: new Set(['evt_new']) },
      );
      expect(errors).toEqual([
        'chapters[0].nodeIds: t0 is retired; main-path nodes must be resolved',
        'chapters[0].nodeIds: n_other is not a node of this Goal',
        'chapters[0].nodeIds: report is not a node of this Goal',
        'chapters[0].findingIds: t1 is not a finding of this Goal',
        'chapters[0].findingIds: f_other is not a finding of this Goal',
        'chapters[0].workVersionIds: wv_other is not a Work version linked to this Goal',
        'chapters[0].detours[0].nodeIds: t2 is resolved and not superseded by revises/contradicts',
        'nextSteps[0].nodeIds: n_other is not a node of this Goal',
        'chapters[0].nodeIds: t0 is not on the mainline',
        'chapters[0].detours[0].nodeIds: t2 is on the mainline; a detour cannot be',
        'mainline.nodeIds: t1 is on the mainline but no chapter tells it',
        'mainline.nodeIds: t2 is on the mainline but no chapter tells it',
        'mainline.nodeIds: acc is on the mainline but no chapter tells it',
        'deliverableWorkId: work_other is not a Work linked to this Goal',
        'graphCursor: evt_other is not an event of this Goal',
      ]);
    });

    describe('mainline', () => {
      const check = (mainline: GoalReportMetadata['mainline']) =>
        validateGoalReport(snapshot, { ...valid, mainline });

      it('is required on a new submission', () => {
        expect(check(undefined)).toEqual([
          'mainline: required — mark the nodes and edges of the path that led to the result',
        ]);
      });

      it('keeps only resolved nodes of this Goal, of a kind that can carry the story', () => {
        expect(
          check({
            edgeIds: [],
            nodeIds: ['t1', 't2', 'acc', 't0', 'n_other', 'report', 'gate_node'],
          }),
        ).toEqual([
          'mainline.nodeIds: t0 is retired; mainline nodes must be resolved',
          'mainline.nodeIds: n_other is not a node of this Goal',
          'mainline.nodeIds: report is not a node of this Goal',
          'mainline.nodeIds: gate_node is not a node of this Goal',
          'chapters[0].detours[1].nodeIds: t0 is on the mainline; a detour cannot be',
        ]);

        const withDecision = graph({
          ...snapshot,
          nodes: [...snapshot.nodes, node('d1', { kind: 'decision', status: 'resolved' })],
        });
        expect(
          validateGoalReport(withDecision, {
            ...valid,
            mainline: { edgeIds: [], nodeIds: ['t1', 't2', 'acc', 'd1'] },
          }),
        ).toEqual([
          'mainline.nodeIds: d1 is a decision; only problem, task, experiment and finding nodes can be on the mainline',
        ]);
      });

      it('keeps only edges of this Goal whose both ends are on the mainline', () => {
        expect(
          check({
            edgeIds: ['t2-depends_on-t1', 't0-depends_on-t1', 't2-revises-t1b', 'e_other'],
            nodeIds: ['t1', 't2', 'acc'],
          }),
        ).toEqual([
          'mainline.edgeIds: t0-depends_on-t1 connects t0, which is not a mainline node',
          'mainline.edgeIds: t2-revises-t1b connects t1b, which is not a mainline node',
          'mainline.edgeIds: e_other is not an edge of this Goal',
        ]);
      });

      it('must be the same path the chapters tell', () => {
        expect(
          validateGoalReport(snapshot, {
            ...valid,
            chapters: [valid.chapters[0]],
            mainline: { edgeIds: [], nodeIds: ['t2', 'acc'] },
          }),
        ).toEqual([
          'chapters[0].nodeIds: t1 is not on the mainline',
          'mainline.nodeIds: acc is on the mainline but no chapter tells it',
        ]);
      });
    });
  });
});
