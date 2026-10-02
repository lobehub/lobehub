import { GOAL_ACCEPTANCE_TASK_TITLE, GOAL_REPORT_TASK_TITLE } from '@lobechat/const/goal';
import type { GoalReportState } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { GoalGraphView, GoalNodeView } from './goalGraphViewModel';
import {
  buildAbandonedNodes,
  buildCriterionOutcomes,
  buildResultTrail,
  buildStoryChapters,
  buildUserDecisions,
  type CheckLike,
  countGoalTasks,
  deriveGoalResultStatus,
  deriveSignOffState,
  findFinalAcceptanceView,
  findGoalAcceptanceGate,
  findOpenChangeRequest,
  goalResultHeadline,
  hasGoalResult,
  isGoalReportOrganizing,
  latestRoundRunId,
  resultTrailSource,
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
  {
    artifacts = [] as unknown[],
    decisions = [] as unknown[],
    findings = [] as unknown[],
    gates = [] as GoalNodeView[],
  } = {},
) =>
  ({
    artifacts,
    byId: Object.fromEntries([...nodes, ...gates].map((view) => [view.node.id, view])),
    decisions,
    findings,
    goal: { status: goalStatus },
    nodes: [...nodes, ...gates],
  }) as unknown as GoalGraphView;

/** The gate node the coordinator opens (via `leads_to`) on a failed Task. */
const gateNode = (subject: GoalNodeView, id = 'gate-1') =>
  ({
    gateSubjectId: subject.node.id,
    node: { id, kind: 'decision', status: 'waiting', title: 'Choose how to recover failed task' },
  }) as unknown as GoalNodeView;

const gateDecision = (
  gate: GoalNodeView,
  {
    resolvedAt = undefined as Date | undefined,
    resolvedOptionId = undefined as string | undefined,
  } = {},
) => ({
  id: `d-${gate.node.id}-${resolvedOptionId ?? 'pending'}`,
  nodeId: gate.node.id,
  options: [
    { id: 'retry', label: 'Retry goal acceptance' },
    { id: 'retire', label: 'Abandon goal acceptance' },
    { id: 'fail', label: 'Fail goal' },
  ],
  question:
    'Goal-level acceptance did not pass. Retry Goal acceptance, abandon it, or fail this Goal?',
  recommendedOptionId: 'retry',
  status: resolvedOptionId ? 'resolved' : 'pending',
  ...(resolvedOptionId ? { resolvedAt, resolvedByUserId: 'u1', resolvedOptionId } : {}),
});

/** A Goal the owner sent back for changes: reopened, its acceptance node active again. */
const reopened = (goalStatus: string) =>
  ({
    ...graph(goalStatus, [node('active')]),
    goal: {
      config: {
        changeRequest: {
          comment: 'Add a day-one agenda',
          requestedAt: '2026-09-29T00:00:00.000Z',
          taskId: 'task-acc',
        },
      },
      status: goalStatus,
    },
  }) as unknown as GoalGraphView;

describe('owner change request', () => {
  it('keeps the result page on a Goal reopened for changes', () => {
    expect(hasGoalResult(reopened('running'))).toBe(true);
    expect(findOpenChangeRequest(reopened('running'))?.comment).toBe('Add a day-one agenda');
  });

  it('reads 修改中 while the rework runs, not 等你验收', () => {
    expect(
      deriveGoalResultStatus({
        acceptanceStatus: 'rejected',
        changesRequested: !!findOpenChangeRequest(reopened('running')),
        goalStatus: 'running',
        unmetCriteria: 0,
      }),
    ).toBe('revising');
    // The rework's new round delivered, the Goal not yet re-achieved.
    expect(
      deriveGoalResultStatus({
        acceptanceStatus: 'delivered',
        changesRequested: true,
        goalStatus: 'running',
        unmetCriteria: 0,
      }),
    ).toBe('revising');
  });

  it('waits on sign-off again once the rework is achieved', () => {
    const achieved = reopened('achieved');
    expect(findOpenChangeRequest(achieved)).toBeUndefined();
    expect(
      deriveGoalResultStatus({
        acceptanceStatus: 'delivered',
        changesRequested: !!findOpenChangeRequest(achieved),
        goalStatus: 'achieved',
        unmetCriteria: 0,
      }),
    ).toBe('awaitingSignOff');
  });

  it('lets a gate the rework opened take over from 修改中', () => {
    expect(
      deriveGoalResultStatus({
        acceptanceStatus: 'delivered',
        changesRequested: true,
        gate: 'pending',
        goalStatus: 'review',
        unmetCriteria: 1,
      }),
    ).toBe('awaitingDecision');
  });
});

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

describe('hasGoalResult for a Goal acceptance that ended unmet', () => {
  /**
   * Regression (acceptance b92f4920): the Goal-level acceptance failed and the
   * coordinator parked the Goal in `review` behind a retry / fail gate. The
   * acceptance node is `waiting`, not `resolved`, so no result tab showed and
   * the owner was asked to decide without seeing which criteria failed.
   */
  it('offers a result while the acceptance gate waits on the owner', () => {
    const acceptance = node('waiting');
    const gate = gateNode(acceptance);
    const view = graph('review', [acceptance], {
      decisions: [gateDecision(gate)],
      gates: [gate],
    });

    expect(hasGoalResult(view)).toBe(true);
    expect(findGoalAcceptanceGate(view)).toMatchObject({ kind: 'pending' });
  });

  it('keeps the result through the retry the owner chose', () => {
    const acceptance = node('active');
    const gate = gateNode(acceptance);
    const view = graph('running', [acceptance], {
      decisions: [gateDecision(gate, { resolvedAt: new Date(1), resolvedOptionId: 'retry' })],
      gates: [gate],
    });

    expect(hasGoalResult(view)).toBe(true);
    expect(findGoalAcceptanceGate(view)?.kind).toBe('retrying');
  });

  it('keeps the result after the owner failed the Goal, even with no output', () => {
    const acceptance = node('retired');
    const gate = gateNode(acceptance);
    const view = graph('failed', [acceptance], {
      decisions: [gateDecision(gate, { resolvedAt: new Date(1), resolvedOptionId: 'fail' })],
      gates: [gate],
    });

    expect(hasGoalResult(view)).toBe(true);
    expect(findGoalAcceptanceGate(view)?.kind).toBe('decided');
  });

  it('reads the newest gate when a retried acceptance failed again', () => {
    const acceptance = node('waiting');
    const first = gateNode(acceptance, 'gate-1');
    const second = gateNode(acceptance, 'gate-2');
    const view = graph('review', [acceptance], {
      decisions: [
        gateDecision(first, { resolvedAt: new Date(1), resolvedOptionId: 'retry' }),
        gateDecision(second),
      ],
      gates: [first, second],
    });

    expect(findGoalAcceptanceGate(view)).toMatchObject({
      decision: { nodeId: 'gate-2' },
      kind: 'pending',
    });
  });

  it('ignores gates opened on ordinary Tasks', () => {
    const task = node('waiting', { title: 'Write the draft' });
    const gate = gateNode(task);
    const view = graph('review', [task], { decisions: [gateDecision(gate)], gates: [gate] });

    expect(findGoalAcceptanceGate(view)).toBeUndefined();
    expect(hasGoalResult(view)).toBe(false);
  });
});

describe('deriveGoalResultStatus', () => {
  it('reads a pending Goal-acceptance gate as waiting on the owner’s call', () => {
    expect(
      deriveGoalResultStatus({
        acceptanceStatus: 'errored',
        gate: 'pending',
        goalStatus: 'review',
        unmetCriteria: 2,
      }),
    ).toBe('awaitingDecision');
  });

  it('moves to revising after retry, and to partial after the owner fails the Goal', () => {
    expect(
      deriveGoalResultStatus({
        acceptanceStatus: 'verifying',
        gate: 'retrying',
        goalStatus: 'running',
        unmetCriteria: 2,
      }),
    ).toBe('revising');
    expect(
      deriveGoalResultStatus({
        acceptanceStatus: 'rejected',
        gate: 'decided',
        goalStatus: 'failed',
        unmetCriteria: 2,
      }),
    ).toBe('partial');
    expect(
      deriveGoalResultStatus({
        acceptanceStatus: 'delivered',
        gate: 'decided',
        goalStatus: 'canceled',
        unmetCriteria: 2,
      }),
    ).toBe('partial');
  });

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
  /**
   * Regression (T-558 acceptance): after the owner failed the Goal at its
   * acceptance gate, the unmet round left the acceptance `delivered` and the
   * page still offered 接受交付 / 提出修改 on a failed Goal.
   */
  it('reads a Goal the owner failed at the acceptance gate as stopped', () => {
    expect(deriveSignOffState('delivered', 'failed', 'decided')).toBe('stopped');
    // 放弃任务 ends the Goal as canceled — the same stopped strip.
    expect(deriveSignOffState('delivered', 'canceled', 'decided')).toBe('stopped');
    expect(deriveSignOffState('accepted', 'failed', 'decided')).toBe('accepted');
  });

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
      goal: { config: {} } as any,
    });

    expect(trail.map((step) => step.key)).toEqual(['task-b', 'task-a', 'unattributed']);
    expect(trail[0].findings).toEqual([findingB]);
    expect(trail[0].artifacts.map((a) => a.workVersionId)).toEqual(['v-b']);
    expect(trail[1].findings).toEqual([findingA]);
    expect(trail[2].findings).toEqual([orphan]);
    expect(trail[2].view).toBeUndefined();
  });
});

describe('buildResultTrail without the wrap-up Task', () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 8, 28, 0, minutes));
  const task = (id: string, title: string, minutes: number) =>
    ({
      node: { createdAt: at(minutes), id, kind: 'task', resolvedAt: at(minutes), title },
    }) as unknown as GoalNodeView;

  /**
   * Regression: the wrap-up Task that writes the Goal report showed up in the
   * derived trail as the last step of the work it describes.
   */
  it('leaves the wrap-up Task and its output out of the derived trail', () => {
    const work = task('task-a', 'Collect sources', 1);
    const wrapUp = task('wrap', GOAL_REPORT_TASK_TITLE, 9);
    const finding = {
      node: { createdAt: at(10), id: 'f-wrap', kind: 'finding', resolvedAt: at(10), title: 'x' },
      producedBy: { id: 'wrap' },
    } as unknown as GoalNodeView;

    const trail = buildResultTrail({
      artifacts: [
        { createdAt: at(2), nodeId: 'task-a', workVersionId: 'v-a' } as any,
        { createdAt: at(9), nodeId: 'wrap', workVersionId: 'v-wrap' } as any,
      ],
      byId: { 'task': work, 'task-a': work, 'wrap': wrapUp },
      findings: [finding],
      goal: { config: { report: { nodeId: 'wrap' } } } as any,
    });

    expect(trail.map((step) => step.key)).toEqual(['task-a']);
  });

  /**
   * Regression: the wrap-up was recognised by its title, so ordinary work that
   * happened to be called the same vanished from the trail and the task count.
   */
  it('keeps a task that only shares the wrap-up title', () => {
    const lookalike = task('task-b', GOAL_REPORT_TASK_TITLE, 3);
    const goal = { config: { report: { nodeId: 'wrap' } } } as any;

    const trail = buildResultTrail({
      artifacts: [{ createdAt: at(3), nodeId: 'task-b', workVersionId: 'v-b' } as any],
      byId: { 'task-b': lookalike },
      findings: [],
      goal,
    });

    expect(trail.map((step) => step.key)).toEqual(['task-b']);
    expect(countGoalTasks({ goal, nodes: [lookalike] })).toBe(1);
  });
});

describe('resultTrailSource', () => {
  const metadata = {
    chapters: [
      {
        detours: [],
        findingIds: [],
        narrative: 'We started from the brief.',
        nodeIds: ['task-a'],
        title: 'Reading the brief',
        workVersionIds: [],
      },
    ],
    graphCursor: 'evt-1',
    headline: 'Shipped the report',
    nextSteps: [],
  };
  const latest = {
    content: '# Report',
    createdAt: new Date(),
    metadata,
    version: 1,
    workId: 'wk-report',
    workVersionId: 'v-report',
  };
  const report = (state: Partial<GoalReportState>) => ({
    report: {
      dispatch: { acceptanceKey: 'k', dispatchedAt: '', nodeId: 'wrap', trigger: 'accepted' },
      status: 'completed',
      ...state,
    } as GoalReportState,
  });

  /**
   * The section switches between three states as the wrap-up run moves: it
   * says the storyline is being written, then shows it, and falls back to the
   * derived trail whenever there is no storyline to show.
   */
  it('shows the organizing state while the wrap-up run is in flight', () => {
    expect(resultTrailSource(report({ status: 'running' })).kind).toBe('pending');
    // A report from an earlier acceptance result is being rewritten: not current.
    expect(resultTrailSource(report({ latest, status: 'running' })).kind).toBe('pending');
  });

  it('shows the storyline once the report is submitted', () => {
    const source = resultTrailSource(report({ latest, status: 'completed' }));
    expect(source.kind).toBe('story');
    expect(source.kind === 'story' && source.metadata.headline).toBe('Shipped the report');
  });

  it('falls back to the derived trail without a report or when the run failed', () => {
    expect(resultTrailSource({}).kind).toBe('derived');
    expect(resultTrailSource(report({ status: 'failed' })).kind).toBe('derived');
    expect(resultTrailSource(report({ latest, status: 'failed' })).kind).toBe('derived');
    expect(resultTrailSource(report({ status: 'completed' })).kind).toBe('derived');
  });

  it('falls back when the stored storyline does not parse', () => {
    const broken = { ...latest, metadata: { headline: 'x' } as any };
    expect(resultTrailSource(report({ latest: broken, status: 'completed' })).kind).toBe('derived');
  });
});

describe('buildStoryChapters', () => {
  const view = (id: string, kind: string) =>
    ({ node: { id, kind, title: id } }) as unknown as GoalNodeView;

  it('resolves each chapter against the graph, in report order, with its detours', () => {
    const byId = {
      'dead': view('dead', 'task'),
      'f-1': view('f-1', 'finding'),
      'task-a': view('task-a', 'task'),
      'task-b': view('task-b', 'task'),
    };
    const chapters = buildStoryChapters(
      {
        artifacts: [{ nodeId: 'task-b', workVersionId: 'v-1' } as any],
        byId,
      },
      {
        chapters: [
          {
            detours: [
              {
                kind: 'dead_end',
                lesson: 'Check the API first',
                nodeIds: ['dead', 'gone'],
                reason: 'The API was retired',
                title: 'Scraping the old API',
              },
            ],
            findingIds: ['f-1', 'task-a', 'missing'],
            narrative: 'First',
            nodeIds: ['task-a'],
            title: 'Find the source',
            workVersionIds: [],
          },
          {
            detours: [],
            findingIds: [],
            narrative: 'Then',
            nodeIds: ['task-b'],
            title: 'Write it up',
            workVersionIds: ['v-1', 'v-gone'],
          },
        ],
      },
    );

    expect(chapters.map((chapter) => chapter.chapter.title)).toEqual([
      'Find the source',
      'Write it up',
    ]);
    // Only findings that exist and are findings become list items.
    expect(chapters[0].findings.map((item) => item.node.id)).toEqual(['f-1']);
    // The local map: main path plus detour nodes still on the graph.
    expect(chapters[0].mapNodeIds).toEqual(['task-a', 'dead']);
    expect(chapters[0].detourNodeIds).toEqual(['dead']);
    expect(chapters[1].artifacts.map((item) => item.workVersionId)).toEqual(['v-1']);
    expect(chapters[1].detourNodeIds).toEqual([]);
  });
});

describe('goalResultHeadline', () => {
  const reportAt = (status: string, headline?: string) =>
    ({
      report: { latest: headline ? { metadata: { headline } } : undefined, status },
    }) as unknown as Pick<GoalGraphView, 'report'>;

  /**
   * Regression: a new result's wrap-up runs while `report.latest` is still the
   * version written for the previous one, so the header named the old result on
   * top of the rework. The headline of this result only exists once its own run
   * has landed; until then the caller shows the organizing state.
   */
  it('names this result, but never the previous one while the next is being written', () => {
    expect(goalResultHeadline(reportAt('completed', 'Shipped the brief'))).toBe(
      'Shipped the brief',
    );
    expect(goalResultHeadline(reportAt('running', 'Old headline'))).toBeUndefined();
    expect(isGoalReportOrganizing(reportAt('running', 'Old headline'))).toBe(true);

    expect(goalResultHeadline(reportAt('completed'))).toBeUndefined();
    expect(isGoalReportOrganizing(reportAt('completed', 'Shipped the brief'))).toBe(false);
  });
});
