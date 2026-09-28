import { GOAL_ACCEPTANCE_TASK_TITLE } from '@lobechat/const/goal';
import { describe, expect, it } from 'vitest';

import type { GoalGraphView, GoalNodeView } from './goalGraphViewModel';
import {
  buildAbandonedNodes,
  buildCriterionOutcomes,
  buildResultTrail,
  buildUserDecisions,
  type CheckLike,
  deriveGoalResultStatus,
  deriveSignOffState,
  findFinalAcceptanceView,
  hasGoalResult,
  latestRoundRunId,
} from './goalResultState';

const node = (
  status: string,
  { acceptance = true, title = GOAL_ACCEPTANCE_TASK_TITLE } = {},
): GoalNodeView =>
  ({
    acceptance: acceptance ? { id: 'acc-1', status: 'delivered' } : undefined,
    node: { id: `n-${status}-${title}`, kind: 'task', status, title },
  }) as unknown as GoalNodeView;

const graph = (
  goalStatus: string,
  nodes: GoalNodeView[],
  { artifacts = [] as unknown[], findings = [] as unknown[] } = {},
) => ({ artifacts, findings, goal: { status: goalStatus }, nodes }) as unknown as GoalGraphView;

describe('hasGoalResult', () => {
  /**
   * Regression: a finished Goal wrapped its delivery inside the 当前任务 section
   * of the process view. The result gets its own tab once the Goal is done.
   */
  it('offers a result once the final acceptance task resolved', () => {
    expect(hasGoalResult(graph('review', [node('resolved')]))).toBe(true);
  });

  it('offers a result for an achieved Goal without a final acceptance task', () => {
    expect(hasGoalResult(graph('achieved', []))).toBe(true);
  });

  it('keeps a running Goal on the process view', () => {
    expect(hasGoalResult(graph('running', [node('active')]))).toBe(false);
    expect(hasGoalResult(graph('running', [node('resolved', { acceptance: false })]))).toBe(false);
    expect(hasGoalResult(graph('running', [node('resolved', { title: 'Other task' })]))).toBe(
      false,
    );
  });
});

describe('hasGoalResult for a Goal that stopped', () => {
  /**
   * Regression: a failed or canceled Goal kept only the process view, so the
   * partial result it did produce had no page to be reviewed or continued from.
   */
  it('offers a result for a failed or canceled Goal that produced something', () => {
    expect(hasGoalResult(graph('failed', [], { artifacts: [{}] }))).toBe(true);
    expect(hasGoalResult(graph('canceled', [], { findings: [{}] }))).toBe(true);
  });

  it('keeps a stopped Goal with no output on the process view', () => {
    expect(hasGoalResult(graph('failed', []))).toBe(false);
    expect(hasGoalResult(graph('canceled', []))).toBe(false);
  });

  it('does not open a result for a running Goal just because it has output', () => {
    expect(hasGoalResult(graph('running', [], { artifacts: [{}] }))).toBe(false);
  });
});

describe('deriveGoalResultStatus', () => {
  it('reads an achieved, unsigned Goal as waiting on the owner', () => {
    expect(
      deriveGoalResultStatus({
        acceptanceStatus: 'delivered',
        goalStatus: 'achieved',
        unmetCriteria: 0,
      }),
    ).toBe('awaitingSignOff');
    expect(deriveGoalResultStatus({ goalStatus: 'achieved', unmetCriteria: 0 })).toBe(
      'awaitingSignOff',
    );
  });

  it('reads an accepted delivery as signed off', () => {
    expect(
      deriveGoalResultStatus({
        acceptanceStatus: 'accepted',
        goalStatus: 'achieved',
        unmetCriteria: 0,
      }),
    ).toBe('signedOff');
  });

  it('reads a failed or canceled Goal as a partial result', () => {
    expect(deriveGoalResultStatus({ goalStatus: 'failed', unmetCriteria: 0 })).toBe('partial');
    expect(
      deriveGoalResultStatus({
        acceptanceStatus: 'delivered',
        goalStatus: 'canceled',
        unmetCriteria: 0,
      }),
    ).toBe('partial');
  });

  it('reads an unachieved Goal whose acceptance found unmet criteria as partial', () => {
    expect(
      deriveGoalResultStatus({
        acceptanceStatus: 'delivered',
        goalStatus: 'review',
        unmetCriteria: 1,
      }),
    ).toBe('partial');
  });
});

describe('deriveSignOffState', () => {
  it('opens sign-off only on an acceptance the server can still decide', () => {
    expect(deriveSignOffState('delivered', 'achieved')).toBe('open');
    expect(deriveSignOffState('errored', 'review')).toBe('open');
    expect(deriveSignOffState('accepted', 'achieved')).toBe('accepted');
    expect(deriveSignOffState('rejected', 'achieved')).toBe('changesRequested');
    expect(deriveSignOffState('repairing', 'running')).toBe('changesRequested');
    expect(deriveSignOffState('verifying', 'review')).toBe('unavailable');
    expect(deriveSignOffState(undefined, 'achieved')).toBe('unavailable');
  });

  /**
   * Regression: a failed Goal whose acceptance the coordinator rejected read
   * "your feedback went back to the Agent" though the owner never asked for
   * changes and nothing is running.
   */
  it('reads a stopped Goal with nothing to sign as stopped, not as changes requested', () => {
    expect(deriveSignOffState('rejected', 'failed')).toBe('stopped');
    expect(deriveSignOffState(undefined, 'canceled')).toBe('stopped');
    // A stopped Goal whose delivery still waits on the owner keeps its sign-off.
    expect(deriveSignOffState('delivered', 'failed')).toBe('open');
  });
});

describe('buildCriterionOutcomes', () => {
  const criteria = [
    { id: 'c1', title: 'Covers every source' },
    { id: 'c2', title: 'Cites evidence' },
    { id: 'c3', title: 'Has a summary' },
  ];
  const check = (
    id: string,
    runId: string,
    verdict: string,
    extra: Partial<CheckLike['result']> = {},
    evidence: CheckLike['evidence'] = [],
  ): CheckLike => ({
    evidence,
    id,
    result: {
      id: `r-${id}-${runId}`,
      sourceCriterionId: id,
      status: verdict === 'uncertain' ? 'passed' : verdict,
      verdict,
      verifyRunId: runId,
      ...extra,
    },
  });

  /**
   * Regression: the result page only linked to the acceptance, so the owner
   * could not see which criterion held and which did not. Each criterion now
   * carries the latest round's verdict, a one-line evidence summary and, when
   * unmet, the reason.
   */
  it('maps each criterion to the latest round result, in criteriaIds order', () => {
    const outcomes = buildCriterionOutcomes({
      checks: [
        check('c2', 'run-2', 'failed', {
          toulmin: {
            evidence: 'Two claims have no source',
            reasoning: 'Sources are missing\nmore',
          },
        }),
        check(
          'c1',
          'run-2',
          'passed',
          { toulmin: { evidence: '## All 12 sources covered\ndetails' } },
          [{ description: 'Source table', id: 'e1', type: 'markdown' }],
        ),
      ],
      criteria,
      criteriaIds: ['c1', 'c2', 'c3'],
      latestRunId: 'run-2',
    });

    expect(outcomes.map((o) => [o.criterion.id, o.state])).toEqual([
      ['c1', 'passed'],
      ['c2', 'failed'],
      ['c3', 'unjudged'],
    ]);
    expect(outcomes[0].summary).toBe('All 12 sources covered');
    expect(outcomes[0].reason).toBeUndefined();
    expect(outcomes[0].evidence.map((e) => e.id)).toEqual(['e1']);
    expect(outcomes[1].summary).toBe('Two claims have no source');
    expect(outcomes[1].reason).toBe('Sources are missing');
    expect(outcomes[2].evidence).toEqual([]);
  });

  it('ignores results from earlier rounds', () => {
    const outcomes = buildCriterionOutcomes({
      checks: [check('c1', 'run-1', 'passed')],
      criteria,
      criteriaIds: ['c1'],
      latestRunId: 'run-2',
    });
    expect(outcomes[0].state).toBe('unjudged');
  });

  it('matches on sourceCriterionId even when the check row id differs', () => {
    const outcomes = buildCriterionOutcomes({
      checks: [{ ...check('c1', 'run-2', 'passed'), id: 'plan-item-7' }],
      criteria,
      criteriaIds: ['c1'],
      latestRunId: 'run-2',
    });
    expect(outcomes[0].state).toBe('passed');
  });

  it('treats an uncertain verdict as undecided and a failure without toulmin via suggestion', () => {
    const outcomes = buildCriterionOutcomes({
      checks: [
        check('c1', 'run-2', 'uncertain'),
        check('c2', 'run-2', 'failed', { suggestion: 'Add the missing citations' }),
      ],
      criteria,
      criteriaIds: ['c1', 'c2'],
      latestRunId: 'run-2',
    });
    expect(outcomes.map((o) => o.state)).toEqual(['unjudged', 'failed']);
    expect(outcomes[1].reason).toBe('Add the missing citations');
  });

  it('skips criterion ids whose rows are gone', () => {
    expect(
      buildCriterionOutcomes({ checks: [], criteria, criteriaIds: ['gone', 'c1'] }).map(
        (o) => o.criterion.id,
      ),
    ).toEqual(['c1']);
  });
});

describe('latestRoundRunId', () => {
  it('picks the highest round index', () => {
    expect(
      latestRoundRunId([{ run: { id: 'b', roundIndex: 2 } }, { run: { id: 'a', roundIndex: 1 } }]),
    ).toBe('b');
    expect(latestRoundRunId([])).toBeUndefined();
  });
});

describe('buildUserDecisions', () => {
  const decision = (id: string, extra: Record<string, unknown>) =>
    ({
      id,
      options: [
        { id: 'a', label: 'Option A' },
        { id: 'b', label: 'Option B' },
      ],
      question: `Question ${id}`,
      resolution: null,
      resolvedAt: null,
      resolvedByAgentId: null,
      resolvedByUserId: null,
      resolvedOptionId: null,
      status: 'resolved',
      ...extra,
    }) as any;

  it('keeps only decisions a person resolved, oldest first', () => {
    const views = buildUserDecisions([
      decision('late', {
        resolvedAt: new Date(2000),
        resolvedByUserId: 'u1',
        resolvedOptionId: 'b',
      }),
      decision('agent', {
        resolvedAt: new Date(1500),
        resolvedByAgentId: 'agt',
        resolvedOptionId: 'a',
      }),
      decision('open', { status: 'pending' }),
      decision('early', {
        resolution: 'Ship it',
        resolvedAt: new Date(1000),
        resolvedByUserId: 'u1',
      }),
    ]);

    expect(views.map((v) => [v.decision.id, v.choice])).toEqual([
      ['early', 'Ship it'],
      ['late', 'Option B'],
    ]);
  });

  it('omits a missing choice or time instead of inventing one', () => {
    const [view] = buildUserDecisions([decision('bare', { resolvedByUserId: 'u1' })]);
    expect(view.choice).toBeUndefined();
    expect(view.resolvedAt).toBeUndefined();
  });
});

describe('buildAbandonedNodes', () => {
  it('lists rejected and retired tasks with the reason that ended them', () => {
    const task = (id: string, status: string, attempts: unknown[] = []) =>
      ({ attempts, node: { id, kind: 'task', status, title: id } }) as unknown as GoalNodeView;

    const abandoned = buildAbandonedNodes({
      nodes: [
        task('done', 'resolved'),
        task('retired', 'retired', [
          { outcome: 'failed', reason: 'First try' },
          { outcome: 'retired', reason: 'Source site is down' },
        ]),
        task('rejected', 'rejected'),
        {
          ...task('closed-early', 'retired'),
          closedReason: 'Goal canceled before it started',
        } as GoalNodeView,
      ],
    });

    expect(abandoned.map((a) => [a.view.node.id, a.reason])).toEqual([
      ['retired', 'Source site is down'],
      ['rejected', undefined],
      ['closed-early', 'Goal canceled before it started'],
    ]);
  });
});

describe('findFinalAcceptanceView', () => {
  it('picks the resolved final acceptance task', () => {
    const accepted = node('resolved');
    expect(findFinalAcceptanceView({ nodes: [node('active'), accepted] })).toBe(accepted);
  });
});

describe('buildResultTrail', () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 8, 28, 0, minutes));
  const view = (id: string, kind: string, minutes: number, producedBy?: string) =>
    ({
      node: { createdAt: at(minutes), id, kind, resolvedAt: at(minutes), title: id },
      producedBy: producedBy ? { id: producedBy } : undefined,
    }) as unknown as GoalNodeView;
  const artifact = (id: string, nodeId: string, minutes: number) =>
    ({ createdAt: at(minutes), nodeId, workVersionId: id }) as any;

  /**
   * Regression: the result tab listed 交付物 and 结论 as two unrelated lists,
   * leaving no path from a conclusion to the files behind it. Each step now
   * carries both, joined on the task that produced them.
   */
  it('joins conclusions and deliverables on the task that produced them, in order', () => {
    const taskA = view('task-a', 'task', 10);
    const taskB = view('task-b', 'task', 5);
    const idle = view('task-idle', 'task', 1);
    const findingA = view('finding-a', 'finding', 11, 'task-a');
    const findingB = view('finding-b', 'finding', 6, 'task-b');
    const orphan = view('finding-orphan', 'finding', 20);

    const trail = buildResultTrail({
      artifacts: [artifact('v-a', 'task-a', 12), artifact('v-b', 'task-b', 7)],
      byId: { 'task-a': taskA, 'task-b': taskB, 'task-idle': idle },
      findings: [findingA, orphan, findingB],
    });

    expect(trail.map((step) => step.key)).toEqual(['task-b', 'task-a', 'unattributed']);
    expect(trail[0].findings).toEqual([findingB]);
    expect(trail[0].artifacts.map((a) => a.workVersionId)).toEqual(['v-b']);
    expect(trail[1].findings).toEqual([findingA]);
    expect(trail[2].findings).toEqual([orphan]);
    expect(trail[2].view).toBeUndefined();
  });
});
