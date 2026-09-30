import type {
  ReadGoalGraphParams,
  SubmitGoalReportParams,
} from '@lobechat/builtin-tool-goal/report';

import { GoalGraphModel } from '@/database/models/goalGraph';
import type { ToolExecutionContext } from '@/server/services/toolExecution/types';

import { withoutGoalReport } from './report';
import { GoalReportStore } from './reportStore';

const DESCRIPTION_PREVIEW = 600;

/** The wrap-up agent's tools. Every call is bound to the server-created wrap-up run. */
export class GoalReportTools {
  constructor(
    private readonly context: Pick<
      ToolExecutionContext,
      'agentId' | 'operationId' | 'serverDB' | 'toolCallId' | 'topicId' | 'userId' | 'workspaceId'
    >,
  ) {}

  private run = async (action: () => Promise<unknown>) => {
    try {
      return { content: JSON.stringify(await action()), success: true };
    } catch (error) {
      console.error('[goal:report:tool] call failed', error);
      return {
        content: error instanceof Error ? error.message : 'Goal report tool failed',
        success: false,
      };
    }
  };

  readGoalGraph = (params: ReadGoalGraphParams) =>
    this.run(async () => {
      const { serverDB, userId, workspaceId } = this.context;
      const graph = await new GoalGraphModel(serverDB!, userId!, workspaceId).getGraph(
        params.goalId,
      );
      if (!graph) throw new Error('Goal not found');
      const view = withoutGoalReport(graph);
      return {
        decisions: view.decisions.map((decision) => ({
          id: decision.id,
          nodeId: decision.nodeId,
          question: decision.question,
          resolution: decision.resolution,
          resolvedOptionId: decision.resolvedOptionId,
          status: decision.status,
        })),
        edges: view.edges.map((edge) => ({
          kind: edge.kind,
          source: edge.sourceNodeId,
          target: edge.targetNodeId,
        })),
        goal: {
          id: view.goal.id,
          requirement: view.goal.requirement,
          status: view.goal.status,
          title: view.goal.title,
        },
        nodes: view.nodes.map((node) => ({
          description: node.description?.slice(0, DESCRIPTION_PREVIEW) ?? null,
          id: node.id,
          kind: node.kind,
          status: node.status,
          title: node.title,
        })),
        workVersions: view.workVersions.map((link) => ({
          nodeId: link.nodeId,
          relation: link.relation,
          title: link.work?.title ?? null,
          type: link.work?.type ?? null,
          workId: link.work?.workId ?? null,
          workVersionId: link.workVersionId,
        })),
      };
    });

  submitGoalReport = ({ content, goalId, ...metadata }: SubmitGoalReportParams) =>
    this.run(async () => {
      const { agentId, operationId, serverDB, toolCallId, topicId, userId, workspaceId } =
        this.context;
      return new GoalReportStore(serverDB!, userId!, workspaceId).submit(
        goalId,
        { content, metadata },
        { agentId, operationId, toolCallId, topicId: topicId ?? null },
      );
    });
}
