import type { AgentState } from '@lobechat/agent-runtime';
import type { AgentOperationStatus, ChatToolPayload } from '@lobechat/types';
import { isAgentOperationSettled, RequestTrigger } from '@lobechat/types';
import { and, desc, eq, isNull, lte } from 'drizzle-orm';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { FileModel } from '@/database/models/file';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { type AgentOperationItem, agentOperations, messages } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { createAgentStateManager } from '@/server/modules/AgentRuntime/factory';
import type { IAgentStateManager } from '@/server/modules/AgentRuntime/types';
import { assertOperationVisibleToCaller } from '@/server/routers/lambda/_helpers/operationReadGuard';
import { assertCanUseWorkspaceAgent } from '@/server/routers/lambda/_helpers/workspaceAgentGuard';
import { bridgeLegacyResumeToSourceIntervention } from '@/server/routers/lambda/aiAgent/exec';
import {
  assertCanUseAgentRunConversation,
  assertCanUseOperationAgent,
} from '@/server/routers/lambda/aiAgent/guards';
import { stopPendingApprovalBatch } from '@/server/routers/lambda/aiAgent/intervention';
import { AgentRuntimeService } from '@/server/services/agentRuntime';
import { AiAgentService } from '@/server/services/aiAgent';
import { startComposerRun } from '@/server/services/aiAgent/composerRun';
import {
  listFollowUps,
  queueFollowUp,
  removeFollowUp,
} from '@/server/services/aiAgent/steerQueue/followUps';
import {
  ForeignLiveRunError,
  TopicStartReservationError,
} from '@/server/services/aiAgent/topicStartReservation';

import { BaseService } from '../common/base.service';
import type { ServiceResult } from '../types';
import type {
  CancelRunResult,
  CreateRunRequest,
  CreateRunResult,
  QueueRunMessageRequest,
  QueueRunMessageResult,
  RemoveRunQueuedMessageResult,
  ResolveRunInterventionRequest,
  ResolveRunInterventionResult,
  Run,
  RunIntervention,
  RunQueuedMessage,
  RunStatus,
  RunToolCall,
  SubmitRunToolResultsRequest,
  SubmitRunToolResultsResult,
} from '../types/run.type';
import { TERMINAL_RUN_STATUSES } from '../types/run.type';
import { ClientToolResumeError, resumeParkedClientTools } from './client-tool-resume.responses';

/** Function tools the API caller supplied and runs itself (`lobe-client-fn____<name>`). */
const CALLER_TOOL_IDENTIFIER = 'lobe-client-fn';
/** Built-in tool whose calls ask the user a question instead of asking for approval. */
const USER_INTERACTION_IDENTIFIER = 'lobe-user-interaction';
/** Stored on the parked operation's metadata when this API resumes it as a new run. */
export const CONTINUED_BY_METADATA_KEY = 'continuedByRunId';

const isCallerTool = (tool: ChatToolPayload) => tool.identifier === CALLER_TOOL_IDENTIFIER;

export const toRunToolCall = (tool: ChatToolPayload): RunToolCall => ({
  arguments: tool.arguments || '{}',
  id: tool.id,
  name: isCallerTool(tool) ? tool.apiName : `${tool.identifier}____${tool.apiName}`,
});

export const toRunIntervention = (tool: ChatToolPayload): RunIntervention => ({
  id: tool.id,
  tool: {
    apiName: tool.apiName,
    arguments: tool.arguments || '{}',
    identifier: tool.identifier,
  },
  type: tool.identifier === USER_INTERACTION_IDENTIFIER ? 'question' : 'approval',
});

/** Interventions a parked state waits on; empty for any other state. */
export const pendingInterventionsOf = (
  state?: Pick<AgentState, 'pendingToolsCalling' | 'status'> | null,
) =>
  state?.status === 'waiting_for_human'
    ? ((state.pendingToolsCalling ?? []) as ChatToolPayload[])
        .filter((tool) => !isCallerTool(tool))
        .map(toRunIntervention)
    : [];

/** The caller's function calls a parked state waits on; empty for any other state. */
export const pendingCallerToolCallsOf = (
  state?: Pick<AgentState, 'pendingToolsCalling' | 'status'> | null,
) =>
  state?.status === 'waiting_for_async_tool'
    ? ((state.pendingToolsCalling ?? []) as ChatToolPayload[])
        .filter(isCallerTool)
        .map(toRunToolCall)
    : [];

/**
 * Public status of a run: the settled database row wins; while it is in
 * flight the live runtime state is fresher than the row.
 */
export const toRunStatus = (
  rowStatus: AgentOperationStatus,
  state?: AgentState | null,
): RunStatus => {
  const status = isAgentOperationSettled(rowStatus) ? rowStatus : (state?.status ?? rowStatus);
  switch (status) {
    case 'idle': {
      return 'queued';
    }
    case 'waiting_for_human': {
      return 'waiting_for_human';
    }
    case 'waiting_for_async_tool': {
      return pendingCallerToolCallsOf(state).length > 0
        ? 'waiting_for_tool_results'
        : 'waiting_for_async_tool';
    }
    case 'done': {
      return 'completed';
    }
    case 'error': {
      return 'failed';
    }
    case 'interrupted': {
      return 'cancelled';
    }
    case 'abandoned': {
      return 'abandoned';
    }
    default: {
      // `running`, and `waiting_for_client` (a device runs the model call).
      return 'running';
    }
  }
};

const toRunError = (error: unknown): Run['error'] => {
  if (!error) return null;
  if (typeof error === 'string') return { message: error, type: null };
  if (typeof error !== 'object') return { message: String(error), type: null };
  const record = error as Record<string, unknown>;
  const body = record.body as Record<string, any> | undefined;
  const message = [record.message, body?.error?.message, body?.message, record.errorType].find(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  const type = [record.type, record.errorType, record.name].find(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  return { message: message ?? type ?? 'Run failed', type: type ?? null };
};

const iso = (value?: Date | string | null) =>
  value ? (value instanceof Date ? value : new Date(value)).toISOString() : null;

export interface RunRestServiceOptions {
  /** Defaults to the deployment's runtime state store (Redis, or in-memory). */
  stateManager?: IAgentStateManager;
}

/**
 * Agent runs REST service.
 *
 * A run is one agent operation (`agent_operations` row + its live runtime
 * state). Starting, cancelling and resuming go through the same services the
 * app's composer and the `aiAgent.*` tRPC procedures use; this layer maps them
 * to a stable public shape and decides who may ask.
 */
export class RunRestService extends BaseService {
  private readonly stateManager: IAgentStateManager;

  constructor(
    db: LobeChatDatabase,
    userId: string | null,
    workspaceId?: string,
    options: RunRestServiceOptions = {},
  ) {
    super(db, userId, workspaceId);
    this.stateManager = options.stateManager ?? createAgentStateManager();
  }

  private aiAgentService() {
    return new AiAgentService(this.db, this.userId, { workspaceId: this.workspaceId });
  }

  // ==================== Access ====================

  /**
   * The run row, when the caller may see it in the workspace the request acts
   * in. Ids are not bearer tokens: anything else is a 404, so the API does not
   * confirm which runs exist.
   */
  async requireRun(id: string): Promise<AgentOperationItem> {
    await assertOperationVisibleToCaller({
      db: this.db,
      operationId: id,
      userId: this.userId,
      workspaceId: this.workspaceId,
    });
    const [row] = await this.db
      .select()
      .from(agentOperations)
      .where(eq(agentOperations.id, id))
      .limit(1);
    // A run belongs to exactly one scope: the personal space or one workspace.
    if (!row || (row.workspaceId ?? undefined) !== this.workspaceId) {
      throw this.createNotFoundError('Run not found');
    }
    return row;
  }

  /** {@link requireRun}, plus `use` access to the run's agent for writes. */
  private async requireWritableRun(id: string) {
    const row = await this.requireRun(id);
    await assertCanUseOperationAgent({
      db: this.db,
      operationId: id,
      userId: this.userId,
      workspaceId: this.workspaceId,
    });
    return row;
  }

  loadState(id: string) {
    return this.stateManager.loadAgentState(id).catch(() => null);
  }

  // ==================== Create ====================

  async createRun(input: CreateRunRequest): ServiceResult<CreateRunResult> {
    const permission = await this.resolveOperationPermission(
      'MESSAGE_CREATE',
      input.topicId ? { targetTopicId: input.topicId } : undefined,
    );
    if (!permission.isPermitted) {
      throw this.createAuthorizationError(permission.message || 'No permission to start runs');
    }

    const supervisorId = input.groupId
      ? await this.resolveGroupSupervisor(input.groupId, input.agentId)
      : undefined;
    const agentId = supervisorId ?? input.agentId!;

    await assertCanUseWorkspaceAgent({
      agentId,
      db: this.db,
      groupId: input.groupId,
      userId: this.userId,
      workspaceId: this.workspaceId,
    });

    if (input.topicId) {
      const topic = await new TopicModel(this.db, this.userId, this.workspaceId).findById(
        input.topicId,
      );
      if (!topic) throw this.createNotFoundError('Topic not found');
      if (input.groupId && topic.groupId !== input.groupId) {
        throw this.createConflictError('The conversation does not belong to this group');
      }
      await assertCanUseAgentRunConversation({
        db: this.db,
        topicId: input.topicId,
        userId: this.userId,
        workspaceId: this.workspaceId,
      });
    }

    if (input.fileIds?.length) {
      const accessible = await new FileModel(this.db, this.userId, this.workspaceId).findByIds(
        input.fileIds,
      );
      if (accessible.length !== new Set(input.fileIds).size) {
        throw this.createAuthorizationError('One or more attachments are unavailable');
      }
    }

    const aiAgentService = this.aiAgentService();

    if (input.scheduledAt) {
      const scheduled = await aiAgentService.scheduleAgentRun({
        agentId,
        fileIds: input.fileIds,
        groupId: input.groupId,
        prompt: input.input,
        runAt: input.scheduledAt,
      });
      return {
        id: null,
        scheduledAt: scheduled.runAt,
        status: 'scheduled',
        topicId: scheduled.topicId,
        userMessageId: null,
      };
    }

    const fileIds = input.fileIds?.length ? { fileIds: input.fileIds } : {};
    let result: {
      error?: string;
      operationId: string;
      success?: boolean;
      topicId: string;
      userMessageId?: string;
    };
    try {
      result =
        supervisorId && input.groupId
          ? await aiAgentService.execGroupAgent({
              agentId: supervisorId,
              ...fileIds,
              groupId: input.groupId,
              message: input.input,
              topicId: input.topicId,
            })
          : await aiAgentService.execAgent({
              agentId,
              appContext: input.topicId ? { topicId: input.topicId } : undefined,
              ...fileIds,
              functionTools: input.tools?.length
                ? input.tools.map(({ description, name, parameters }) => ({
                    description,
                    name,
                    parameters,
                  }))
                : undefined,
              prompt: input.input,
              trigger: RequestTrigger.Api,
              userInterventionConfig: {
                approvalMode: input.approvalMode ?? 'headless',
                ...(input.allowList ? { allowList: input.allowList } : {}),
              },
            });
    } catch (error) {
      if (error instanceof ForeignLiveRunError || error instanceof TopicStartReservationError) {
        throw this.createConflictError(
          'The conversation is busy with another run; wait until it finishes or queue a message on it.',
        );
      }
      throw error;
    }

    if (result.success === false) {
      throw this.createBusinessError(result.error || 'The agent could not start the run');
    }

    this.log('info', 'Run started', {
      group: !!supervisorId,
      operationId: result.operationId,
      topicId: result.topicId,
    });
    return {
      id: result.operationId,
      scheduledAt: null,
      status: 'queued',
      topicId: result.topicId,
      userMessageId: result.userMessageId ?? null,
    };
  }

  private async resolveGroupSupervisor(groupId: string, agentId?: string): Promise<string> {
    const groupModel = new ChatGroupModel(this.db, this.userId, this.workspaceId);
    if (!(await groupModel.findById(groupId))) throw this.createNotFoundError('Group not found');

    if (agentId) {
      const members = await groupModel.getGroupAgents(groupId);
      if (!members.some((member) => member.agentId === agentId)) {
        throw this.createConflictError('agentId is not a member of this group');
      }
    }

    const supervisorId = await groupModel.getSupervisorAgentId(groupId);
    // Only a supervisor orchestrates a group turn; no fallback to a member.
    if (!supervisorId) throw this.createConflictError('This group has no supervisor agent');
    return supervisorId;
  }

  // ==================== Read ====================

  async getRun(id: string): ServiceResult<Run> {
    const row = await this.requireRun(id);
    return this.toRun(row, await this.loadState(id));
  }

  /** The run plus the interventions it waits on, read together for the event stream. */
  async snapshot(id: string): Promise<{ interventions: RunIntervention[]; run: Run }> {
    const row = await this.requireRun(id);
    const state = await this.loadState(id);
    return { interventions: pendingInterventionsOf(state), run: await this.toRun(row, state) };
  }

  /** Public shape of a run row, overlaid with its live runtime state. */
  async toRun(row: AgentOperationItem, state: AgentState | null): Promise<Run> {
    const status = toRunStatus(row.status, state);
    const tokens = state?.usage?.llm?.tokens;
    const continuedBy = row.metadata?.[CONTINUED_BY_METADATA_KEY];

    return {
      agentId: row.agentId ?? null,
      completedAt: iso(row.completedAt),
      completionReason: row.completionReason ?? null,
      continuedByRunId: typeof continuedBy === 'string' ? continuedBy : null,
      cost: {
        currency: row.currency ?? 'USD',
        total: row.totalCost ?? state?.cost?.total ?? null,
      },
      createdAt: iso(row.createdAt)!,
      error: status === 'failed' ? toRunError(row.error ?? state?.error) : null,
      groupId: row.chatGroupId ?? null,
      id: row.id,
      maxSteps: row.maxSteps ?? state?.maxSteps ?? null,
      model: row.model ?? null,
      parentRunId: row.parentOperationId ?? null,
      pendingInterventionCount:
        status === 'waiting_for_human' ? pendingInterventionsOf(state).length : 0,
      pendingToolCalls:
        status === 'waiting_for_tool_results' ? pendingCallerToolCallsOf(state) : [],
      provider: row.provider ?? null,
      result: status === 'completed' ? await this.findResult(row) : null,
      startedAt: iso(row.startedAt),
      status,
      stepCount: state?.usage?.llm?.apiCalls ?? row.llmCalls ?? 0,
      taskId: row.taskId ?? null,
      threadId: row.threadId ?? null,
      topicId: row.topicId ?? null,
      trigger: row.trigger ?? null,
      usage: {
        inputTokens: row.totalInputTokens ?? tokens?.input ?? 0,
        llmCalls: row.llmCalls ?? state?.usage?.llm?.apiCalls ?? 0,
        outputTokens: row.totalOutputTokens ?? tokens?.output ?? 0,
        toolCalls: row.toolCalls ?? state?.usage?.tools?.totalCalls ?? 0,
        totalTokens: row.totalTokens ?? tokens?.total ?? 0,
      },
    };
  }

  /**
   * The last assistant reply the run wrote in its conversation: the newest one
   * up to the run's completion. No lower bound — the operation row is written
   * after the turn's first messages, so its `createdAt` cannot fence them.
   */
  async findResult(row: AgentOperationItem): Promise<Run['result']> {
    if (!row.topicId) return null;
    const [message] = await this.db
      .select({ content: messages.content, id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.topicId, row.topicId),
          row.threadId ? eq(messages.threadId, row.threadId) : isNull(messages.threadId),
          eq(messages.role, 'assistant'),
          ...(row.completedAt ? [lte(messages.createdAt, row.completedAt)] : []),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(1);
    return message ? { content: message.content ?? null, messageId: message.id } : null;
  }

  // ==================== Cancel ====================

  async cancelRun(id: string): ServiceResult<CancelRunResult> {
    const row = await this.requireWritableRun(id);
    const state = await this.loadState(id);
    const status = toRunStatus(row.status, state);
    if (TERMINAL_RUN_STATUSES.includes(status)) return { cancelled: false, id, status };

    const aiAgentService = this.aiAgentService();
    const batch = state?.pendingApprovalBatch;
    const toolMessageIds = Object.values(state?.pendingToolMessageIds ?? {});
    const parkedOnApproval =
      status === 'waiting_for_human' && !!batch && !!row.topicId && toolMessageIds.length > 0;
    this.log('info', 'Cancelling run', {
      operationId: id,
      path: parkedOnApproval ? 'stopPendingApproval' : 'interrupt',
      status,
    });
    if (parkedOnApproval) {
      // A parked run has no loop left to observe an interrupt flag: settle its
      // pending tool rows and end it, as the app's "stop" on an approval does.
      await stopPendingApprovalBatch(
        {
          aiAgentService,
          messageModel: new MessageModel(this.db, this.userId, this.workspaceId),
          serverDB: this.db,
          userId: this.userId,
          workspaceId: this.workspaceId,
        },
        { batchId: batch!.id, operationId: id, toolMessageIds, topicId: row.topicId! },
      );
    } else {
      const result = await aiAgentService.interruptTask({
        operationId: id,
        topicId: row.topicId ?? undefined,
      });
      if (!result.success) {
        throw this.createConflictError('The run could not be cancelled; try again.');
      }
    }

    return { cancelled: true, id, status: 'cancelled' };
  }

  // ==================== Interventions ====================

  async listInterventions(id: string): ServiceResult<{ items: RunIntervention[] }> {
    await this.requireRun(id);
    return { items: pendingInterventionsOf(await this.loadState(id)) };
  }

  async resolveIntervention(
    id: string,
    interventionId: string,
    body: ResolveRunInterventionRequest,
  ): ServiceResult<ResolveRunInterventionResult> {
    const row = await this.requireWritableRun(id);
    const state = await this.loadState(id);
    const intervention = pendingInterventionsOf(state).find((item) => item.id === interventionId);
    if (!intervention || !row.topicId) {
      throw this.createNotFoundError('No pending intervention with this id on the run');
    }
    if (
      (body.action === 'answer' || body.action === 'skip') !==
      (intervention.type === 'question')
    ) {
      throw this.createValidationError(
        intervention.type === 'question'
          ? 'This intervention is a question: answer or skip it'
          : 'This intervention is an approval: approve or reject it',
      );
    }

    const messageModel = new MessageModel(this.db, this.userId, this.workspaceId);
    const toolMessageId =
      state?.pendingToolMessageIds?.[interventionId] ??
      (await messageModel.findToolMessageIdByToolCallId(interventionId));
    if (!toolMessageId) throw this.createNotFoundError('The pending tool call has no message');

    await assertCanUseAgentRunConversation({
      db: this.db,
      messageIds: [toolMessageId],
      topicId: row.topicId,
      userId: this.userId,
      workspaceId: this.workspaceId,
    });

    const resume =
      body.action === 'approve' || body.action === 'reject'
        ? {
            resumeApproval: {
              decision:
                body.action === 'approve'
                  ? ('approved' as const)
                  : body.continue
                    ? ('rejected_continue' as const)
                    : ('rejected' as const),
              parentMessageId: toolMessageId,
              ...(body.action === 'reject' && body.reason ? { rejectionReason: body.reason } : {}),
              toolCallId: interventionId,
            },
          }
        : {
            resumeToolResult: {
              content: body.action === 'answer' ? body.content : '',
              outcome: body.action === 'answer' ? ('submitted' as const) : ('skipped' as const),
              parentMessageId: toolMessageId,
              ...(body.action === 'answer' && body.answers
                ? { pluginState: { askUserAnswers: body.answers } }
                : {}),
              ...(body.action === 'skip' && body.reason ? { rejectionReason: body.reason } : {}),
              toolCallId: interventionId,
            },
          };

    const aiAgentService = this.aiAgentService();
    const dispatchContext = {
      aiAgentService,
      serverDB: this.db,
      userId: this.userId,
      workspaceId: this.workspaceId,
    };
    // Cloud resolves the durable intervention row first; OSS falls through to
    // the message-row resume the app uses.
    const continuation =
      (await bridgeLegacyResumeToSourceIntervention(
        { messageModel, parentMessageId: toolMessageId, ...resume },
        dispatchContext,
      )) ??
      (await startComposerRun(
        { aiAgentService, db: this.db, userId: this.userId, workspaceId: this.workspaceId },
        {
          agentId: row.agentId ?? undefined,
          appContext: {
            groupId: row.chatGroupId ?? undefined,
            threadId: row.threadId ?? undefined,
            topicId: row.topicId,
          },
          parentMessageId: toolMessageId,
          prompt: '',
          trigger: RequestTrigger.Api,
          // The continuation handles its tool calls the way the parked run did.
          userInterventionConfig:
            state?.principal?.policy?.userIntervention ?? state?.userInterventionConfig,
          ...resume,
        },
      ));

    if (!continuation?.operationId) {
      throw this.createBusinessError('The run could not be resumed');
    }
    await new AgentOperationModel(this.db, this.userId, this.workspaceId).mergeMetadata(id, {
      [CONTINUED_BY_METADATA_KEY]: continuation.operationId,
    });
    this.log('info', 'Intervention resolved', {
      action: body.action,
      continuedByRunId: continuation.operationId,
      operationId: id,
    });

    return { continuedByRunId: continuation.operationId, interventionId };
  }

  // ==================== Client tool results ====================

  async submitToolResults(
    id: string,
    body: SubmitRunToolResultsRequest,
  ): ServiceResult<SubmitRunToolResultsResult> {
    const row = await this.requireWritableRun(id);
    const notWaiting = () =>
      this.createConflictError('The run is not waiting for results of your tools');
    if (!row.topicId) throw notWaiting();

    let resumed: Awaited<ReturnType<typeof resumeParkedClientTools>>;
    try {
      resumed = await resumeParkedClientTools({
        agentRuntimeService: new AgentRuntimeService(this.db, this.userId, {
          workspaceId: this.workspaceId,
        }),
        db: this.db,
        operationId: id,
        outputs: body.results.map(({ callId, output }) => ({
          call_id: callId,
          output,
          type: 'function_call_output' as const,
        })),
        resumeInBackground: true,
        topicId: row.topicId,
        userId: row.userId,
        workspaceId: this.workspaceId,
      });
    } catch (error) {
      // The caller sent results that do not answer the pending calls, or a
      // retry after another delivery already resumed the run.
      if (error instanceof ClientToolResumeError) {
        throw error.reason === 'already_submitted'
          ? this.createConflictError(error.message)
          : this.createValidationError(error.message);
      }
      throw error;
    }
    if (!resumed) throw notWaiting();
    this.log('info', 'Tool results accepted', {
      held: !!resumed.held,
      operationId: id,
    });

    return { callIds: resumed.callIds, id, state: resumed.held ? 'held' : 'resumed' };
  }

  // ==================== Queued messages ====================

  private queueScope(row: AgentOperationItem) {
    if (!row.topicId) throw this.createConflictError('The run has no conversation to queue into');
    return { threadId: row.threadId ?? null, topicId: row.topicId, userId: this.userId };
  }

  async queueMessage(
    id: string,
    body: QueueRunMessageRequest,
  ): ServiceResult<QueueRunMessageResult> {
    const row = await this.requireWritableRun(id);
    const scope = this.queueScope(row);
    await assertCanUseAgentRunConversation({
      db: this.db,
      topicId: scope.topicId,
      userId: this.userId,
      workspaceId: this.workspaceId,
    });

    const result = await queueFollowUp(
      { db: this.db, userId: this.userId, workspaceId: this.workspaceId },
      {
        id: body.id,
        request: {
          agentId: row.agentId ?? undefined,
          appContext: {
            groupId: row.chatGroupId ?? undefined,
            threadId: row.threadId ?? undefined,
            topicId: scope.topicId,
          },
          ...(body.fileIds?.length ? { fileIds: body.fileIds } : {}),
          prompt: body.content,
          trigger: RequestTrigger.Api,
        },
        // Only behind this run: another live run in the conversation is not it.
        behindOperationId: id,
        scope,
      },
    );

    if (!result.queued) {
      throw result.reason === 'idle'
        ? this.createConflictError(
            'The run is not running anymore, or another run now drives its conversation; start a new run instead.',
          )
        : this.createConflictError(
            result.reason === 'full'
              ? 'Too many messages are queued behind this run'
              : 'The message could not be queued; retry with the same id',
          );
    }
    return { id: result.id, length: result.length, state: result.state };
  }

  async listQueuedMessages(id: string): ServiceResult<{ items: RunQueuedMessage[] }> {
    const row = await this.requireRun(id);
    const items = await listFollowUps(this.queueScope(row));
    return {
      items: items.map((item) => ({
        content: item.prompt,
        createdAt: new Date(item.createdAt).toISOString(),
        delivering: item.delivering,
        fileIds: item.fileIds ?? [],
        id: item.id,
      })),
    };
  }

  async removeQueuedMessage(
    id: string,
    messageId: string,
  ): ServiceResult<RemoveRunQueuedMessageResult> {
    const row = await this.requireWritableRun(id);
    const { removed, state } = await removeFollowUp(this.queueScope(row), messageId);
    return { id: messageId, removed, state };
  }
}
