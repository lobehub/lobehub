import type { GoalGraphSnapshot } from '@lobechat/types';

import {
  buildGoalGraphView,
  type GoalGraphView,
} from '@/features/AgentGoals/ProcessControl/goalGraphViewModel';

import type { SharedGoalData } from './sharedGoalTypes';

/**
 * The shared view carries no real ids, owners, costs or events, but the
 * exploration map is drawn from the full graph view model. This fills the
 * fields the map never shows with inert values and lets the same
 * `buildGoalGraphView` the product uses derive the rest, so the shared map
 * cannot drift from the in-app one.
 */
export const sharedGoalToGraphView = (view: SharedGoalData): GoalGraphView => {
  const at = (index: number) => new Date(index);
  const goalId = 'shared-goal';
  const nodeStatuses = new Map(view.nodes.map((node) => [node.id, node.status]));

  const snapshot: GoalGraphSnapshot = {
    decisions: [],
    edges: view.edges
      // A dangling edge would only make the layout guess; the server already drops them.
      .filter((edge) => nodeStatuses.has(edge.from) && nodeStatuses.has(edge.to))
      .map((edge, index) => ({
        createdAt: at(index),
        goalId,
        id: edge.id,
        kind: edge.kind,
        sourceNodeId: edge.from,
        targetNodeId: edge.to,
      })),
    events: [],
    goal: {
      agentId: null,
      completedAt: null,
      config: null,
      createdAt: at(0),
      id: goalId,
      maxRounds: null,
      maxTotalCost: null,
      projectId: null,
      requirement: view.goal.requirement,
      startedAt: null,
      status: view.goal.status,
      subjectId: null,
      subjectType: null,
      title: view.goal.title,
      updatedAt: at(0),
      userId: '',
      workspaceId: null,
    },
    nodes: view.nodes.map((node, index) => ({
      confidence: null,
      createdAt: at(index),
      createdByAgentId: null,
      createdByUserId: null,
      description: null,
      goalId,
      id: node.id,
      kind: node.kind,
      priority: 0,
      resolvedAt: null,
      status: node.status,
      taskId: null,
      title: node.title,
      updatedAt: at(index),
    })),
    report: view.report
      ? {
          dispatch: { acceptanceKey: '', dispatchedAt: '', nodeId: '', trigger: 'accepted' },
          latest: {
            content: null,
            createdAt: at(0),
            metadata: {
              chapters: view.report.chapters.map((chapter) => ({ ...chapter, workVersionIds: [] })),
              graphCursor: '',
              headline: view.report.headline,
              mainline: view.report.mainline,
              nextSteps: view.report.nextSteps,
            },
            version: 1,
            workId: '',
            workVersionId: '',
          },
          status: 'completed',
        }
      : undefined,
    workVersions: [],
  };

  return buildGoalGraphView(snapshot);
};
