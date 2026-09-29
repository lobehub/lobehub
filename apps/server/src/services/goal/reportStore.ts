import { GoalReportApiName, GoalReportIdentifier } from '@lobechat/builtin-tool-goal/report';
import { GOAL_COORDINATOR_ACTOR_ID } from '@lobechat/const/goal';
import type {
  GoalGraphSnapshot,
  GoalReportDispatch,
  GoalReportMetadata,
  GoalReportState,
} from '@lobechat/types';
import { GoalReportMetadataSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { WorkModel } from '@/database/models/work';
import { goalEvents } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { validateGoalReport } from './report';

/**
 * How long a wrap-up run may go without submitting before the page stops
 * showing it as in progress. The Goal itself never waits on it.
 */
export const GOAL_REPORT_TIMEOUT_MS = 60 * 60 * 1000;

export interface SubmitGoalReportInput {
  content: string;
  metadata: Omit<GoalReportMetadata, 'graphCursor'> & { graphCursor?: string };
}

export interface GoalReportCaller {
  agentId?: string | null;
  operationId?: string | null;
  toolCallId?: string | null;
  topicId?: string | null;
}

/**
 * Writes and reads of the Goal report. Kept free of the task runner (and so of
 * the agent runtime) because the wrap-up agent's tool runtime imports it: the
 * runtime registry sits under the agent runtime, and importing back up into it
 * would be a cycle.
 */
export class GoalReportStore {
  private readonly coordinatorGraph: GoalGraphModel;
  private readonly operationModel: AgentOperationModel;
  private readonly taskModel: TaskModel;
  private readonly taskTopicModel: TaskTopicModel;
  private readonly workModel: WorkModel;

  constructor(
    private readonly db: LobeChatDatabase,
    userId: string,
    workspaceId?: string,
  ) {
    this.coordinatorGraph = new GoalGraphModel(db, userId, workspaceId, {
      id: GOAL_COORDINATOR_ACTOR_ID,
      type: 'system',
    });
    this.operationModel = new AgentOperationModel(db, userId, workspaceId);
    this.taskModel = new TaskModel(db, userId, workspaceId);
    this.taskTopicModel = new TaskTopicModel(db, userId, workspaceId);
    this.workModel = new WorkModel(db, userId, workspaceId);
  }

  // -------------------------------------------------------------------------
  // Submission
  // -------------------------------------------------------------------------

  /**
   * Submit on behalf of a running operation — the CLI path a heterogeneous
   * wrap-up agent takes, since server tools never reach a device run. The
   * operation is looked up with the caller's own ownership, and its topic must
   * be a run of this Goal's wrap-up Task, exactly as for the tool.
   */
  submitFromOperation = async (
    goalId: string,
    input: SubmitGoalReportInput,
    operationId: string,
  ) => {
    const operation = await this.operationModel.findOwnOperationById(operationId);
    if (!operation) throw new TRPCError({ code: 'NOT_FOUND', message: 'Operation not found' });
    return this.submit(goalId, input, {
      agentId: operation.agentId,
      operationId: operation.id,
      topicId: operation.topicId,
    });
  };

  /**
   * Validate and store one report version.
   *
   * When `caller` is given (the tool path), it must be a run of this Goal's
   * wrap-up Task — no other conversation can rewrite a Goal's report.
   */
  submit = async (goalId: string, input: SubmitGoalReportInput, caller?: GoalReportCaller) => {
    const graph = await this.coordinatorGraph.getGraph(goalId);
    if (!graph) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    const dispatch = graph.goal.config?.report;
    if (!dispatch)
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'No wrap-up was dispatched for this Goal',
      });

    if (caller) {
      const runs = dispatch.taskId ? await this.taskTopicModel.findByTaskId(dispatch.taskId) : [];
      if (!caller.topicId || !runs.some((run) => run.topicId === caller.topicId))
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'This conversation is not the wrap-up run of this Goal',
        });
    }

    const eventRows = await this.db
      .select({ createdAt: goalEvents.createdAt, id: goalEvents.id })
      .from(goalEvents)
      .where(eq(goalEvents.goalId, goalId));
    const eventIds = new Set(eventRows.map((row) => row.id));
    const newestEvent = eventRows.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0];

    const parsed = GoalReportMetadataSchema.safeParse({
      ...input.metadata,
      graphCursor: input.metadata.graphCursor ?? newestEvent?.id,
    });
    if (!parsed.success)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Invalid report: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      });
    const content = input.content.trim();
    if (!content)
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid report: content is empty' });

    const errors = validateGoalReport(graph, parsed.data, { eventIds });
    if (errors.length > 0)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Invalid report references:\n${errors.join('\n')}`,
      });

    const work = await this.workModel.registerGoalReport({
      agentId: caller?.agentId,
      content,
      goalId,
      metadata: parsed.data,
      rootOperationId: caller?.operationId,
      title: `Goal report: ${graph.goal.title}`,
      toolCallId: caller?.toolCallId,
      toolIdentifier: GoalReportIdentifier,
      toolName: GoalReportApiName.submitGoalReport,
      topicId: caller?.topicId,
    });
    if (work.currentVersionId) {
      await this.coordinatorGraph.attachWorkVersion(
        goalId,
        dispatch.nodeId,
        work.currentVersionId,
        'produced',
      );
    }
    await this.coordinatorGraph.updateNodeStatus(
      goalId,
      dispatch.nodeId,
      'resolved',
      'Goal report submitted',
    );
    const latest = await this.workModel.findLatestGoalReport(goalId);
    return { version: latest?.version, workId: work.id, workVersionId: work.currentVersionId };
  };

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  /** The wrap-up state for a graph read: in progress, completed or failed. */
  state = async (graph: GoalGraphSnapshot): Promise<GoalReportState | undefined> => {
    const dispatch = graph.goal.config?.report;
    if (!dispatch) return undefined;

    const latestRow = await this.workModel.findLatestGoalReport(graph.goal.id);
    const parsed = latestRow
      ? GoalReportMetadataSchema.safeParse(latestRow.metadata?.goalReport)
      : undefined;
    const latest =
      latestRow && parsed?.success
        ? {
            content: latestRow.content,
            createdAt: latestRow.createdAt,
            metadata: parsed.data,
            version: latestRow.version,
            workId: latestRow.workId,
            workVersionId: latestRow.workVersionId,
          }
        : undefined;

    return { dispatch, latest, status: await this.resolveStatus(dispatch, latest?.createdAt) };
  };

  private resolveStatus = async (
    dispatch: GoalReportDispatch,
    latestAt?: Date,
  ): Promise<GoalReportState['status']> => {
    const dispatchedAt = new Date(dispatch.dispatchedAt).getTime();
    if (latestAt && new Date(latestAt).getTime() >= dispatchedAt) return 'completed';
    if (dispatch.error) return 'failed';
    if (Date.now() - dispatchedAt > GOAL_REPORT_TIMEOUT_MS) return 'failed';
    if (!dispatch.taskId) return 'running';
    const task = await this.taskModel.findById(dispatch.taskId);
    if (!task) return 'failed';
    // The run ended — completed, failed, paused on an error — without a report.
    if (['completed', 'failed', 'canceled', 'paused'].includes(task.status)) return 'failed';
    return 'running';
  };
}
