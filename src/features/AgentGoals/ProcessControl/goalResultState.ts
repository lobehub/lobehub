import { GOAL_REPORT_TASK_TITLE } from '@lobechat/const/goal';
import type {
  AcceptanceStatus,
  GoalGraphDecision,
  GoalReportChapter,
  GoalReportMetadata,
  GoalReportVersion,
  ToulminVerdict,
} from '@lobechat/types';
import { GoalReportMetadataSchema } from '@lobechat/types';

import { isGoalAcceptanceTask } from './coordinatorCopy';
import type { GoalArtifactView, GoalGraphView, GoalNodeView } from './goalGraphViewModel';

/**
 * Whether a Goal has an outcome to hand over, which is what earns it the
 * 结果交付 tab.
 *
 * A finished Goal: its final acceptance Task resolved (the result waits on the
 * owner's sign-off, whatever the Goal's own status says), or the Goal was
 * marked achieved without one. A Goal-level acceptance that ended unmet has an
 * outcome too: the gate it opens asks the owner to retry or give up, and the
 * criteria it judged unmet are what that call is made from — so the tab shows
 * while the gate waits, and stays through the retry it may start. A Goal that failed or was canceled still hands
 * over whatever it produced — the partial result is what the owner decides the
 * next step from — so it earns the tab too, as long as something came out. A
 * running Goal keeps the single process view: a result tab there would show a
 * draft as if it were the delivery.
 */

/** The Goal's resolved final acceptance Task, when there is one. */
export const findFinalAcceptanceView = (
  graph: Pick<GoalGraphView, 'nodes'>,
): GoalNodeView | undefined =>
  graph.nodes.find(
    (view) => isGoalAcceptanceTask(view) && view.node.status === 'resolved' && !!view.acceptance,
  );

/** The Goal-level acceptance, settled or not — the one sign-off acts on. */
export const findGoalAcceptanceView = (
  graph: Pick<GoalGraphView, 'nodes'>,
): GoalNodeView | undefined =>
  findFinalAcceptanceView(graph) ??
  graph.nodes.findLast((view) => isGoalAcceptanceTask(view) && !!view.acceptance);

const STOPPED_GOAL_STATUSES = new Set(['canceled', 'failed']);
const TERMINAL_ACCEPTANCE_NODE_STATUSES = new Set(['resolved', 'rejected', 'retired']);

/**
 * The decision gate the coordinator opened after the Goal-level acceptance
 * ended unmet, as the result page reads it:
 *
 * - `pending`  — the gate waits on the owner (retry / fail the Goal).
 * - `retrying` — the owner chose retry and the acceptance is running again.
 * - `decided`  — the owner closed the gate some other way (the Goal was
 *                failed, or the acceptance has since passed).
 */
export type GoalAcceptanceGate =
  | { decision: GoalGraphDecision; kind: 'pending'; subject: GoalNodeView }
  | { decision: GoalGraphDecision; kind: 'decided' | 'retrying'; subject: GoalNodeView };

export const findGoalAcceptanceGate = (
  graph: Pick<GoalGraphView, 'byId' | 'decisions'>,
): GoalAcceptanceGate | undefined => {
  const subjectOf = (decision: GoalGraphDecision) => {
    const subjectId = graph.byId[decision.nodeId]?.gateSubjectId;
    const subject = subjectId ? graph.byId[subjectId] : undefined;
    return subject && isGoalAcceptanceTask(subject) ? subject : undefined;
  };

  const pending = graph.decisions.findLast(
    (decision) => decision.status === 'pending' && !!subjectOf(decision),
  );
  if (pending) return { decision: pending, kind: 'pending', subject: subjectOf(pending)! };

  const decided = graph.decisions
    .filter((decision) => decision.status === 'resolved' && !!subjectOf(decision))
    .sort((a, b) => (a.resolvedAt?.getTime() ?? 0) - (b.resolvedAt?.getTime() ?? 0))
    .at(-1);
  if (!decided) return undefined;

  const subject = subjectOf(decided)!;
  const retrying =
    decided.resolvedOptionId === 'retry' &&
    !TERMINAL_ACCEPTANCE_NODE_STATUSES.has(subject.node.status);
  return { decision: decided, kind: retrying ? 'retrying' : 'decided', subject };
};

/** Anything the Goal left behind that a partial result page can show. */
export const hasGoalOutput = (
  graph: Pick<GoalGraphView, 'artifacts' | 'findings' | 'report'>,
): boolean => graph.artifacts.length > 0 || graph.findings.length > 0 || !!graph.report?.latest;

export const hasGoalResult = (
  graph: Pick<
    GoalGraphView,
    'artifacts' | 'byId' | 'decisions' | 'findings' | 'goal' | 'nodes' | 'report'
  >,
): boolean =>
  graph.goal.status === 'achieved' ||
  !!findFinalAcceptanceView(graph) ||
  !!findGoalAcceptanceGate(graph) ||
  (STOPPED_GOAL_STATUSES.has(graph.goal.status) && hasGoalOutput(graph));

/**
 * Where the result stands for its owner, as the first screen says it:
 *
 * - `awaitingDecision` — the Goal-level acceptance ended unmet and its gate
 *                      waits on the owner: retry, or fail the Goal.
 * - `revising`       — the owner chose retry; the Goal is being reworked and
 *                      accepted again.
 * - `partial`        — the Goal stopped (failed / canceled), or its acceptance
 *                      judged a criterion unmet: what exists is a partial result.
 * - `signedOff`      — the owner accepted the delivery.
 * - `awaitingSignOff` — achieved, and the owner has not signed yet.
 */
export type GoalResultStatus =
  'awaitingDecision' | 'awaitingSignOff' | 'partial' | 'revising' | 'signedOff';

export const deriveGoalResultStatus = ({
  acceptanceStatus,
  gate,
  goalStatus,
  unmetCriteria,
}: {
  acceptanceStatus?: AcceptanceStatus;
  /** The Goal-acceptance gate's state, from {@link findGoalAcceptanceGate}. */
  gate?: GoalAcceptanceGate['kind'];
  goalStatus: string;
  /** Criteria the latest acceptance round judged unmet. */
  unmetCriteria: number;
}): GoalResultStatus => {
  if (acceptanceStatus === 'accepted') return 'signedOff';
  if (STOPPED_GOAL_STATUSES.has(goalStatus)) return 'partial';
  if (gate === 'pending') return 'awaitingDecision';
  if (gate === 'retrying' && goalStatus !== 'achieved') return 'revising';
  if (goalStatus !== 'achieved' && unmetCriteria > 0) return 'partial';
  return 'awaitingSignOff';
};

/**
 * What the sign-off strip can do right now. Only a settled acceptance waits on
 * the owner (`delivered`, or `errored` — the server takes a decision on both);
 * an accepted one is closed, and one rejected on a live Goal is back with the
 * Agent. A Goal that stopped (failed / canceled) with nothing left to sign has
 * ended: its way forward is to continue from what it left, not a sign-off.
 */
export type GoalSignOffState = 'accepted' | 'changesRequested' | 'open' | 'stopped' | 'unavailable';

export const deriveSignOffState = (
  acceptanceStatus: AcceptanceStatus | undefined,
  goalStatus: string,
): GoalSignOffState => {
  if (acceptanceStatus === 'accepted') return 'accepted';
  if (acceptanceStatus === 'delivered' || acceptanceStatus === 'errored') return 'open';
  if (STOPPED_GOAL_STATUSES.has(goalStatus)) return 'stopped';
  if (acceptanceStatus === 'rejected' || acceptanceStatus === 'repairing')
    return 'changesRequested';
  return 'unavailable';
};

// ---------------------------------------------------------------------------
// 验收标准 × 结果
// ---------------------------------------------------------------------------

export interface CriterionLike {
  description?: string | null;
  id: string;
  title: string;
}

export interface CheckResultLike {
  id: string;
  sourceCriterionId: string | null;
  status: string;
  suggestion?: string | null;
  toulmin?: ToulminVerdict | null;
  verdict?: string | null;
  verifyRunId: string | null;
}

export interface EvidenceLike {
  content?: string | null;
  description?: string | null;
  documentId?: string | null;
  fileId?: string | null;
  fileName?: string | null;
  fileUrl?: string | null;
  id: string;
  type: string;
}

export interface CheckLike {
  evidence: EvidenceLike[];
  /** The union row id — `sourceCriterionId ?? checkItemId`. */
  id: string;
  result?: CheckResultLike;
}

export type CriterionOutcomeState = 'failed' | 'passed' | 'unjudged';

export interface CriterionOutcome {
  criterion: CriterionLike;
  evidence: EvidenceLike[];
  /** Why it is unmet (or undecided); absent for a met criterion. */
  reason?: string;
  resultId?: string;
  state: CriterionOutcomeState;
  /** One line of what the evidence showed. */
  summary?: string;
}

/** First meaningful line of a prose field, stripped of markdown lead-ins. */
export const firstLine = (text?: string | null): string | undefined =>
  text
    ?.split('\n')
    .map((line) => line.replace(/^[#>*\-\s]+/, '').trim())
    .find(Boolean);

const outcomeState = (result: CheckResultLike): CriterionOutcomeState => {
  if (result.verdict === 'passed' || (!result.verdict && result.status === 'passed'))
    return 'passed';
  if (result.verdict === 'failed' || (!result.verdict && result.status === 'failed'))
    return 'failed';
  return 'unjudged';
};

/**
 * Each acceptance criterion of the Goal against what the latest Goal-level
 * acceptance round found.
 *
 * Criteria come in `goal.config.acceptance.criteriaIds` order. Only results of
 * the latest round count: an earlier round's verdict is history, and showing it
 * beside the current one would say the Goal met a bar it has since failed (or
 * the reverse). A result is matched on the criterion it was planned from
 * (`sourceCriterionId`), falling back to the union row id, which is the same
 * value for criterion-sourced checks. A criterion the round never judged stays
 * on the list as undecided rather than disappearing.
 */
export const buildCriterionOutcomes = ({
  checks,
  criteria,
  criteriaIds,
  latestRunId,
}: {
  checks: CheckLike[];
  criteria: CriterionLike[];
  criteriaIds: string[];
  latestRunId?: string;
}): CriterionOutcome[] => {
  const criterionById = new Map(criteria.map((criterion) => [criterion.id, criterion]));
  const latest = checks.filter(
    (check) => !!check.result && !!latestRunId && check.result.verifyRunId === latestRunId,
  );
  const checkFor = (criterionId: string) =>
    latest.find((check) => check.result!.sourceCriterionId === criterionId) ??
    latest.find((check) => !check.result!.sourceCriterionId && check.id === criterionId);

  return criteriaIds.flatMap((id): CriterionOutcome[] => {
    const criterion = criterionById.get(id);
    if (!criterion) return [];
    const check = checkFor(id);
    if (!check?.result) return [{ criterion, evidence: [], state: 'unjudged' }];

    const { result } = check;
    const state = outcomeState(result);
    const toulmin = result.toulmin ?? undefined;
    const summary =
      firstLine(toulmin?.evidence) ??
      firstLine(check.evidence.find((item) => item.description)?.description);
    const reason =
      state === 'passed'
        ? undefined
        : (firstLine(toulmin?.counterEvidence) ??
          firstLine(toulmin?.reasoning) ??
          firstLine(result.suggestion));

    return [
      {
        criterion,
        evidence: check.evidence,
        ...(reason ? { reason } : {}),
        resultId: result.id,
        state,
        ...(summary ? { summary } : {}),
      },
    ];
  });
};

/** The newest round of an acceptance, by its round index. */
export const latestRoundRunId = (
  rounds: { run: { id: string; roundIndex: number | null } }[],
): string | undefined =>
  rounds.reduce<{ id: string; roundIndex: number } | undefined>((latest, { run }) => {
    const roundIndex = run.roundIndex ?? 0;
    return !latest || roundIndex >= latest.roundIndex ? { id: run.id, roundIndex } : latest;
  }, undefined)?.id;

// ---------------------------------------------------------------------------
// 你做过的决定 / 没有完成
// ---------------------------------------------------------------------------

export interface UserDecisionView {
  /** The option label the owner picked, or their free-text resolution. */
  choice?: string;
  decision: GoalGraphDecision;
  question: string;
  resolvedAt?: Date;
}

/**
 * Decisions a person made on this Goal, oldest first. An agent resolving a
 * gate by itself is not the owner's decision, and a canceled gate decided
 * nothing — neither belongs on "what you decided".
 */
export const buildUserDecisions = (decisions: GoalGraphDecision[]): UserDecisionView[] =>
  decisions
    .filter((decision) => decision.status === 'resolved' && !!decision.resolvedByUserId)
    .map((decision) => {
      const option = decision.options?.find((item) => item.id === decision.resolvedOptionId);
      const choice = option?.label ?? decision.resolution?.trim() ?? undefined;
      return {
        ...(choice ? { choice } : {}),
        decision,
        question: decision.question,
        ...(decision.resolvedAt ? { resolvedAt: decision.resolvedAt } : {}),
      };
    })
    .sort((a, b) => (a.resolvedAt?.getTime() ?? 0) - (b.resolvedAt?.getTime() ?? 0));

export interface AbandonedNodeView {
  reason?: string;
  view: GoalNodeView;
}

/**
 * Task nodes the Goal gave up on — rejected or retired — with the reason
 * recorded when it closed them, falling back to the attempt that ended it.
 */
export const buildAbandonedNodes = (graph: Pick<GoalGraphView, 'nodes'>): AbandonedNodeView[] =>
  graph.nodes
    .filter(
      (view) =>
        view.node.kind === 'task' &&
        (view.node.status === 'rejected' || view.node.status === 'retired'),
    )
    .map((view) => {
      const reason = firstLine(
        view.closedReason ??
          view.attempts.findLast((attempt) => attempt.outcome !== 'running' && attempt.reason)
            ?.reason,
      );
      return { ...(reason ? { reason } : {}), view };
    });

/**
 * Work Tasks the Goal ran, for the scale line. The coordinator's own acceptance
 * and wrap-up Tasks check and describe the work; they are not part of it.
 */
export const countGoalTasks = (graph: Pick<GoalGraphView, 'nodes'>): number =>
  graph.nodes.filter(
    (view) =>
      view.node.kind === 'task' &&
      !isGoalAcceptanceTask(view) &&
      view.node.title !== GOAL_REPORT_TASK_TITLE,
  ).length;

/** The coordinator's wrap-up Task, which writes the report about the Goal. */
export const isGoalReportTaskView = (view: Pick<GoalNodeView, 'node'>): boolean =>
  view.node.kind === 'task' && view.node.title === GOAL_REPORT_TASK_TITLE;

/**
 * One step of the result's audit trail: the work that ran, what it concluded,
 * and what it produced. `view` is absent for conclusions no task claims.
 */
export interface ResultTrailStep {
  artifacts: GoalArtifactView[];
  findings: GoalNodeView[];
  key: string;
  view?: GoalNodeView;
}

const settledAt = (view: GoalNodeView) => (view.node.resolvedAt ?? view.node.createdAt).getTime();

/**
 * How the result was reached, in the order it happened.
 *
 * Conclusions and deliverables are two views of the same work: a conclusion is
 * what a task found out, a deliverable is what it wrote down. Shown as separate
 * lists they read as loose parts with no way in. Joined on the task that
 * produced them, each step reads top-down — the claim first, then the files
 * that back it, then (one click deeper) the run itself — which is the order a
 * reviewer audits in. Steps that concluded and produced nothing are left out:
 * the trail is about output, the process tab already lists every task.
 */
export const buildResultTrail = (
  graph: Pick<GoalGraphView, 'artifacts' | 'byId' | 'findings'>,
): ResultTrailStep[] => {
  const steps = new Map<string, ResultTrailStep>();
  const orphans: GoalNodeView[] = [];

  const stepOf = (nodeId: string) => {
    let step = steps.get(nodeId);
    if (!step) {
      step = { artifacts: [], findings: [], key: nodeId, view: graph.byId[nodeId] };
      steps.set(nodeId, step);
    }
    return step;
  };

  for (const finding of graph.findings) {
    const producer = finding.producedBy && graph.byId[finding.producedBy.id];
    if (producer && isGoalReportTaskView(producer)) continue;
    if (producer) stepOf(producer.node.id).findings.push(finding);
    else orphans.push(finding);
  }
  for (const artifact of graph.artifacts) {
    if (graph.byId[artifact.nodeId]) stepOf(artifact.nodeId).artifacts.push(artifact);
  }

  const ordered = [...steps.values()]
    // The wrap-up Task describes the result; it is not a step toward it.
    .filter((step) => step.view && !isGoalReportTaskView(step.view))
    .sort((a, b) => settledAt(a.view!) - settledAt(b.view!));
  for (const step of ordered) {
    step.findings.sort((a, b) => settledAt(a) - settledAt(b));
    step.artifacts.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  if (orphans.length > 0)
    ordered.push({
      artifacts: [],
      findings: orphans.sort((a, b) => settledAt(a) - settledAt(b)),
      key: 'unattributed',
    });
  return ordered;
};

// ---------------------------------------------------------------------------
// 探索过程 — the wrap-up storyline, or the derived trail
// ---------------------------------------------------------------------------

/**
 * Where the 探索过程 section reads from:
 *
 * - `pending` — the wrap-up agent is writing the storyline right now; the
 *               graph poll swaps it in when it lands.
 * - `story`   — the storyline submitted for the latest acceptance result.
 * - `derived` — no report, the run failed, or its metadata does not parse:
 *               the trail {@link buildResultTrail} derives from the graph.
 */
export type ResultTrailSource =
  | { kind: 'derived' }
  | { kind: 'pending' }
  | { kind: 'story'; metadata: GoalReportMetadata; report: GoalReportVersion };

export const resultTrailSource = (graph: Pick<GoalGraphView, 'report'>): ResultTrailSource => {
  const { report } = graph;
  if (report?.status === 'running') return { kind: 'pending' };
  if (report?.status !== 'completed' || !report.latest) return { kind: 'derived' };

  // Stored metadata went through the same schema on submit; re-checking here
  // keeps a row written by an older schema from breaking the page.
  const parsed = GoalReportMetadataSchema.safeParse(report.latest.metadata);
  if (!parsed.success) return { kind: 'derived' };
  return { kind: 'story', metadata: parsed.data, report: report.latest };
};

export interface StoryChapterView {
  artifacts: GoalArtifactView[];
  chapter: GoalReportChapter;
  /** Detour nodes still on the graph, called out on the chapter's local map. */
  detourNodeIds: string[];
  findings: GoalNodeView[];
  index: number;
  /** Main-path nodes plus detour nodes — what the chapter's local map shows. */
  mapNodeIds: string[];
}

const unique = (ids: string[]) => [...new Set(ids)];

/**
 * The storyline's chapters, in the order the report wrote them, with their
 * references resolved against the live graph. A reference the graph no longer
 * carries is dropped rather than rendered as an empty row.
 */
export const buildStoryChapters = (
  graph: Pick<GoalGraphView, 'artifacts' | 'byId'>,
  metadata: Pick<GoalReportMetadata, 'chapters'>,
): StoryChapterView[] => {
  const artifactByVersion = new Map(
    graph.artifacts.map((artifact) => [artifact.workVersionId, artifact]),
  );
  const onGraph = (id: string) => !!graph.byId[id];

  return metadata.chapters.map((chapter, index) => {
    const detourNodeIds = unique(chapter.detours.flatMap((detour) => detour.nodeIds)).filter(
      onGraph,
    );
    return {
      artifacts: unique(chapter.workVersionIds).flatMap((id) => {
        const artifact = artifactByVersion.get(id);
        return artifact ? [artifact] : [];
      }),
      chapter,
      detourNodeIds,
      findings: unique(chapter.findingIds).flatMap((id) => {
        const view = graph.byId[id];
        return view?.node.kind === 'finding' ? [view] : [];
      }),
      index,
      mapNodeIds: unique([...chapter.nodeIds.filter(onGraph), ...detourNodeIds]),
    };
  });
};
