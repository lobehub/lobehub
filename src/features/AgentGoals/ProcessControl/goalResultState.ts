import { isGoalAcceptanceTask } from './coordinatorCopy';
import type { GoalArtifactView, GoalGraphView, GoalNodeView } from './goalGraphViewModel';

/**
 * Whether a Goal has an outcome to hand over, which is what earns it the
 * 结果交付 tab.
 *
 * Only a finished Goal: its final acceptance Task resolved (the result waits on
 * the owner's sign-off, whatever the Goal's own status says), or the Goal was
 * marked achieved without one. A running Goal keeps the single process view —
 * a result tab there would show a draft as if it were the delivery.
 */

/** The Goal's resolved final acceptance Task, when there is one. */
export const findFinalAcceptanceView = (
  graph: Pick<GoalGraphView, 'nodes'>,
): GoalNodeView | undefined =>
  graph.nodes.find(
    (view) => isGoalAcceptanceTask(view) && view.node.status === 'resolved' && !!view.acceptance,
  );

export const hasGoalResult = (graph: Pick<GoalGraphView, 'goal' | 'nodes'>): boolean =>
  graph.goal.status === 'achieved' || !!findFinalAcceptanceView(graph);

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
    if (producer) stepOf(producer.node.id).findings.push(finding);
    else orphans.push(finding);
  }
  for (const artifact of graph.artifacts) {
    if (graph.byId[artifact.nodeId]) stepOf(artifact.nodeId).artifacts.push(artifact);
  }

  const ordered = [...steps.values()]
    .filter((step) => step.view)
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
