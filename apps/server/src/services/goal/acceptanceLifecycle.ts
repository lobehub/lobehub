import { createHash } from 'node:crypto';

import { GOAL_ACCEPTANCE_TASK_TITLE } from '@lobechat/const/goal';
import type { GoalGraphNode, GoalGraphSnapshot } from '@lobechat/types';

/** Legacy Goals have no lifecycle; once installed, only its explicit identity counts. */
export const currentAcceptanceNode = (graph: GoalGraphSnapshot) => {
  const lifecycle = graph.goal.config?.acceptance?.lifecycle;
  return graph.nodes.find((node) =>
    lifecycle
      ? node.id === lifecycle.currentNodeId
      : node.kind === 'task' && node.title === GOAL_ACCEPTANCE_TASK_TITLE,
  );
};

export const isGoalAcceptanceNode = (
  graph: GoalGraphSnapshot,
  node: Pick<GoalGraphNode, 'id' | 'kind' | 'title'>,
) => {
  const lifecycle = graph.goal.config?.acceptance?.lifecycle;
  return lifecycle
    ? node.id === lifecycle.currentNodeId ||
        lifecycle.history.some((round) => round.nodeId === node.id)
    : node.kind === 'task' && node.title === GOAL_ACCEPTANCE_TASK_TITLE;
};

/** Immutable produced versions, including repair task delivery, fence verification. */
export const acceptanceEvidenceVersion = (graph: GoalGraphSnapshot) => {
  const acceptanceIds = new Set(
    graph.nodes.filter((node) => isGoalAcceptanceNode(graph, node)).map((node) => node.id),
  );
  const versions = [
    ...new Set(
      graph.workVersions
        .filter(
          (link) =>
            !acceptanceIds.has(link.nodeId) &&
            link.relation === 'produced' &&
            link.work &&
            link.work.type !== 'task',
        )
        .map((link) => link.workVersionId),
    ),
  ].sort();
  return createHash('sha256')
    .update(
      JSON.stringify({
        requirement: graph.goal.requirement,
        criteriaIds: graph.goal.config?.acceptance?.criteriaIds,
        metrics: graph.goal.config?.acceptance?.metrics,
        versions,
      }),
    )
    .digest('hex');
};
