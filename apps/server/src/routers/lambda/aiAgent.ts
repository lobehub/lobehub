import { type AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { parse } from '@lobechat/conversation-flow';
import { type TaskCurrentActivity, type TaskStatusResult } from '@lobechat/types';
import {
  RequestTrigger,
  ThreadStatus,
  ThreadType,
  UserInterventionConfigSchema,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { and, eq } from 'drizzle-orm';
import pMap from 'p-map';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { MessageModel } from '@/database/models/message';
import { ThreadModel } from '@/database/models/thread';
import { TopicModel } from '@/database/models/topic';
import { agentOperations, topics } from '@/database/schemas';
import { heteroAuthedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { signUserJWT } from '@/libs/trpc/utils/internalJwt';
import { createStreamEventManager } from '@/server/modules/AgentRuntime/factory';
import { AgentRuntimeService } from '@/server/services/agentRuntime';
import { AiAgentService } from '@/server/services/aiAgent';
import { AiChatService } from '@/server/services/aiChat';
import { getFileProxyUrl } from '@/server/services/file';
import { HeterogeneousAgentService } from '@/server/services/heterogeneousAgent';

import { workingDirConfigSchema } from './workingDirSchema';

const log = debug('lobe-server:ai-agent-router');

const createUiMessageFileUrlResolver = () => {
  return async (path: string | null, file: { fileType: string; id?: string | null }) =>
    file.id ? getFileProxyUrl(file.id) : (path ?? '');
};

const extractTaskErrorMessage = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return undefined;

  const taskError = error as Record<string, any>;
  const candidates = [
    taskError.body?.error?.message,
    taskError.body?.message,
    taskError.error?.error?.message,
    taskError.error?.message,
    taskError.message,
    taskError.type,
    taskError.errorType,
    taskError.name,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate !== '[object Object]' && candidate !== 'error') {
      return candidate;
    }
  }

  return undefined;
};

const formatTaskError = (error: unknown): Record<string, unknown> | undefined => {
  if (!error) return undefined;

  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }

  if (typeof error === 'string') {
    return { message: error };
  }

  if (typeof error !== 'object') {
    return { message: String(error) };
  }

  const taskError = error as Record<string, unknown>;
  const message = extractTaskErrorMessage(error);

  return message ? { ...taskError, message } : taskError;
};

const GetOperationStatusSchema = z.object({
  historyLimit: z.number().optional().default(10),
  includeHistory: z.boolean().optional().default(false),
  operationId: z.string(),
});

const ProcessHumanInterventionSchema = z.object({
  action: z.enum(['approve', 'reject', 'reject_continue', 'input', 'select']),
  data: z
    .object({
      approvedToolCall: z.any().optional(),
      input: z.any().optional(),
      selection: z.any().optional(),
    })
    .optional(),
  operationId: z.string(),
  reason: z.string().optional(),
  stepIndex: z.number().optional().default(0),
  /**
   * ID of the pending `role='tool'` message targeted by this intervention.
   * Required for approve / reject / reject_continue so the server can update
   * the message's intervention status, content, and — on approve — hand the
   * id to the `call_tool` short-circuit via `skipCreateToolMessage`.
   */
  toolMessageId: z.string().optional(),
});

const GetPendingInterventionsSchema = z
  .object({
    operationId: z.string().optional(),
    userId: z.string().optional(),
  })
  .refine((data) => data.operationId || data.userId, {
    message: 'Either operationId or userId must be provided',
  });

const StartExecutionSchema = z.object({
  context: z.any().optional(),
  delay: z.number().optional().default(1000),
  operationId: z.string(),
  priority: z.enum(['high', 'normal', 'low']).optional().default('normal'),
});

/**
 * Schema for execAgent - execute a single Agent
 */
const ExecAgentSchema = z
  .object({
    /** The agent ID to run (either agentId or slug is required) */
    agentId: z.string().optional(),
    /** Application context for message storage */
    appContext: z
      .object({
        defaultTaskAssigneeAgentId: z.string().optional(),
        documentId: z.string().nullish(),
        /** The agent being edited when scope is 'agent_builder' (not the builder builtin itself). */
        editingAgentId: z.string().optional(),
        groupId: z.string().nullish(),
        initialTopicMetadata: z
          .object({
            repos: z.array(z.string()).optional(),
            workingDirectory: z.string().optional(),
            workingDirectoryConfig: workingDirConfigSchema.optional(),
          })
          .optional(),
        /**
         * Group orchestration role of the run, stamped onto the assistant
         * message's `metadata.orchestrationRole` so the supervisor/member
         * identity survives the gateway step_start snapshot / refetch.
         */
        orchestrationRole: z.enum(['supervisor', 'member']).optional(),
        scope: z.string().nullish(),
        sessionId: z.string().optional(),
        taskId: z.string().nullish(),
        threadId: z.string().nullish(),
        topicId: z.string().nullish(),
      })
      .optional(),
    /** Whether to auto-start execution after creating operation */
    autoStart: z.boolean().optional().default(true),
    /** Explicit device ID to bind to the topic and activate for this run */
    deviceId: z.string().optional(),
    /** Optional existing message IDs to include in context */
    existingMessageIds: z.array(z.string()).optional().default([]),
    /** File IDs of already-uploaded attachments to attach to the new user message */
    fileIds: z.array(z.string()).optional(),
    /** Parent message ID for regeneration/continue (skip user message creation, branch from this message) */
    parentMessageId: z.string().optional(),
    /** The user input/prompt */
    prompt: z.string(),
    /**
     * Resume a previous op paused on `human_approve_required`. When set, the
     * new op writes the decision to the target tool message and either runs
     * the approved tool (`approved`), halts with reason=`human_rejected`
     * (`rejected`), or surfaces the rejection as user feedback so the LLM
     * can continue (`rejected_continue`).
     */
    resumeApproval: z
      .object({
        decision: z.enum(['approved', 'rejected', 'rejected_continue']),
        /** ID of the pending `role='tool'` message this decision targets. */
        parentMessageId: z.string(),
        /** Optional user-supplied rejection reason (only meaningful for rejected variants). */
        rejectionReason: z.string().optional(),
        /** tool_call_id of the pending tool call being approved/rejected. */
        toolCallId: z.string(),
      })
      .optional(),
    /**
     * Resume a previous op paused on a `humanIntervention: 'always'` tool (e.g.
     * lobe-agent `askUserQuestion`). When set, the new op writes the
     * human-provided answer as the target tool message's result and resumes from
     * `phase: 'tool_result'` — the tool is NOT re-executed, so the runtime never
     * overwrites the answer with a fresh "pending" placeholder. Mutually
     * exclusive with `resumeApproval`.
     */
    resumeToolResult: z
      .object({
        /** The human-provided tool result (the answer text). */
        content: z.string(),
        /** ID of the pending `role='tool'` message this result targets. */
        parentMessageId: z.string(),
        /** Optional plugin state to persist on the tool message. */
        pluginState: z.record(z.unknown()).optional(),
        /** tool_call_id of the pending tool call being answered. */
        toolCallId: z.string(),
      })
      .optional(),
    /**
     * Tool identifiers the user @-mentioned in this message. Enabled for this
     * run in addition to the agent's pinned plugins, so a mentioned tool that
     * isn't pinned to the agent (e.g. a custom MCP connector picked from the @
     * list) is callable. Scoped to the caller's own installed tools/connectors
     * by the user-scoped lookups downstream, so it can't enable others' tools.
     */
    selectedToolIds: z.array(z.string()).optional(),
    /**
     * Agents the user @-mentioned in this message (multi-mention). When present
     * (and non-group), the run enables the callAgent tool and injects the
     * mentioned-agents delegation context so the supervisor delegates to them
     * instead of answering itself. Mirrors the client runtime's
     * `initialContext.mentionedAgents` + injected callAgent manifest.
     */
    mentionedAgents: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
    /** The agent slug to run (either agentId or slug is required) */
    slug: z.string().optional(),
    /**
     * What initiated this operation, persisted to `agent_operations.trigger`.
     * Defaults to `'chat'` when omitted — first-party SPA / desktop user
     * messages are the dominant caller. Pass a more specific value (`'cli'`,
     * `'openapi'`, `'eval'`, …) to override.
     */
    trigger: z.string().optional(),
    /**
     * User intervention configuration for tool approvals.
     * Pass `{ approvalMode: 'headless' }` from headless clients (CLI, cron, bots)
     * so tool calls auto-execute without waiting for human approval.
     */
    userInterventionConfig: UserInterventionConfigSchema.optional(),
  })
  .refine((data) => data.agentId || data.slug, {
    message: 'Either agentId or slug must be provided',
  });

/**
 * Schema for execGroupAgent - execute Supervisor Agent in Group chat
 */
const ExecGroupAgentSchema = z.object({
  /** The Supervisor agent ID */
  agentId: z.string(),
  /** File IDs attached to the message */
  files: z.array(z.string()).optional(),
  /** The Group ID */
  groupId: z.string(),
  /** User message content */
  message: z.string(),
  /** Optional: Create a new topic */
  newTopic: z
    .object({
      title: z.string().optional(),
      topicMessageIds: z.array(z.string()).optional(),
    })
    .optional(),
  /** Existing topic ID */
  topicId: z.string().nullish(),
});

/**
 * Schema for execAgents - batch execution of multiple agents
 */
const ExecAgentsSchema = z.object({
  /** Whether to execute tasks in parallel (default: true) */
  parallel: z.boolean().optional().default(true),
  /** Array of agent tasks to execute */
  tasks: z.array(ExecAgentSchema).min(1),
});

/**
 * Schema for execSubAgentTask - execute SubAgent task
 * Supports both Group mode (with groupId) and Single Agent mode (without groupId)
 */
const ExecSubAgentTaskSchema = z.object({
  /** The SubAgent ID to execute the task */
  agentId: z.string(),
  /** The Group ID (optional, only for Group mode) */
  groupId: z.string().optional(),
  /** Task instruction/prompt for the SubAgent */
  instruction: z.string(),
  /** The parent message ID (Supervisor's tool call message or task message) */
  parentMessageId: z.string(),
  /** Timeout in milliseconds (optional) */
  timeout: z.number().optional(),
  /** Task title (shown in UI, used as thread title) */
  title: z.string().optional(),
  /** The Topic ID */
  topicId: z.string(),
});

/**
 * Schema for createClientTaskThread - create Thread for client-side task execution
 * This is used when runInClient=true on desktop client (single agent mode)
 */
const CreateClientTaskThreadSchema = z.object({
  /** The Agent ID to execute the task */
  agentId: z.string(),
  /** The Group ID (optional, only for Group mode) */
  groupId: z.string().optional(),
  /** Initial user message content (task instruction) */
  instruction: z.string(),
  /** The parent message ID (task message) */
  parentMessageId: z.string(),
  /** Task title (shown in UI, used as thread title) */
  title: z.string().optional(),
  /** The Topic ID */
  topicId: z.string(),
});

/**
 * Schema for createClientGroupAgentTaskThread - create Thread for client-side task execution in Group mode
 * This is specifically for Group Chat where messages may have different agentIds
 */
const CreateClientGroupAgentTaskThreadSchema = z.object({
  /** The Group ID (required for Group mode) */
  groupId: z.string(),
  /** Initial user message content (task instruction) */
  instruction: z.string(),
  /** The parent message ID (task message) */
  parentMessageId: z.string(),
  /** The Sub-Agent ID that will execute the task (worker agent in group) */
  subAgentId: z.string(),
  /** Task title (shown in UI, used as thread title) */
  title: z.string().optional(),
  /** The Topic ID */
  topicId: z.string(),
});

/**
 * Schema for updateClientTaskThreadStatus - update Thread status after client-side execution
 */
const UpdateClientTaskThreadStatusSchema = z.object({
  /** Completion reason */
  completionReason: z.enum(['done', 'error', 'interrupted']),
  /** Error message if failed */
  error: z.string().optional(),
  /** Thread metadata to update */
  metadata: z
    .object({
      totalCost: z.number().optional(),
      totalMessages: z.number().optional(),
      totalSteps: z.number().optional(),
      totalTokens: z.number().optional(),
      totalToolCalls: z.number().optional(),
    })
    .optional(),
  /** Result content (last assistant message) */
  resultContent: z.string().optional(),
  /** The Thread ID */
  threadId: z.string(),
});

/**
 * Schema for interruptTask - interrupt a running task
 */
const InterruptTaskSchema = z
  .object({
    /** Operation ID */
    operationId: z.string().optional(),
    /** Thread ID */
    threadId: z.string().optional(),
    /**
     * Topic ID — required to cancel remote hetero tasks (openclaw / hermes).
     * When provided and the topic's runningOperation has a deviceId, the server
     * will dispatch a cancelHeteroTask tool call to kill the remote process.
     */
    topicId: z.string().optional(),
  })
  .refine((data) => data.threadId || data.operationId, {
    message: 'Either threadId or operationId must be provided',
  });

/**
 * Wire shape of an `AgentStreamEvent` produced by `lh hetero exec`. Mirrors
 * `AgentStreamEvent` in `@lobechat/agent-gateway-client` (kept here as a Zod
 * schema for tRPC input validation; tRPC's type inference takes care of the
 * client-side typing). Republished verbatim through `StreamEventManager` so
 * gateway WS subscribers see the same shape regardless of producer.
 */
const AgentStreamEventSchema = z.object({
  data: z.any(),
  operationId: z.string(),
  stepIndex: z.number().int().nonnegative(),
  timestamp: z.number().int().nonnegative(),
  type: z.enum([
    'agent_runtime_init',
    'agent_runtime_end',
    'stream_start',
    'stream_chunk',
    'stream_end',
    'visible_output_end',
    'stream_retry',
    'tool_start',
    'tool_end',
    'tool_execute',
    'tool_result',
    'agent_intervention_request',
    'agent_intervention_response',
    'step_start',
    'step_complete',
    'notify_update',
    'error',
  ]),
});

/**
 * Schema for `aiAgent.heteroIngest` — accepts a batch of producer-side
 * `AgentStreamEvent`s from `lh hetero exec`. `topicId` is required (operationId
 * → topic reverse-lookup is unreliable per design decision).
 */
const HeteroIngestSchema = z.object({
  agentType: z.enum(['claude-code', 'codex']),
  /** Initial assistant placeholder message id forwarded from the sandbox env var.
   * When present, `loadOrCreateState` uses it directly and skips the DB read of
   * topic.metadata.runningOperation, eliminating the replica-lag race condition. */
  assistantMessageId: z.string().min(1).optional(),
  events: z.array(AgentStreamEventSchema).min(1),
  operationId: z.string().min(1),
  topicId: z.string().min(1),
});

/**
 * Schema for `aiAgent.heteroFinish` — terminal call, mirrors the CLI process
 * exit. `result` is the high-level outcome; `error` carries CLI-classified
 * details when `result === 'error'`. `sessionId` is the native CLI session
 * (CC's per-cwd id), kept here so the server can resume next time.
 */
const HeteroFinishSchema = z.object({
  agentType: z.enum(['claude-code', 'codex']),
  error: z
    .object({
      message: z.string(),
      type: z.string(),
    })
    .optional(),
  operationId: z.string().min(1),
  result: z.enum(['success', 'error', 'cancelled']),
  sessionId: z.string().optional(),
  topicId: z.string().min(1),
});

/**
 * Schema for `aiAgent.waitInterventionResponse` — the exec-side long-poll. The
 * `lh hetero exec` producer calls this in a loop while an `AskUserBridge`
 * pending is in flight, draining `agent_intervention_response` events off the
 * op's Redis stream (which the sandbox can't read directly). `lastEventId`
 * threads the cursor forward across polls; `'$'` on the first call means
 * "only events published from now on".
 */
const WaitInterventionResponseSchema = z.object({
  blockMs: z.number().int().positive().max(30_000).default(25_000),
  lastEventId: z.string().default('$'),
  operationId: z.string().min(1),
});

/**
 * Schema for `aiAgent.submitHeteroIntervention` — the browser leg of remote
 * Human-in-the-loop. The user's answer to an `agent_intervention_request` is
 * published back onto the op's Redis stream as an `agent_intervention_response`,
 * where both the renderer (card → resolved) and the exec long-poll converge on
 * it by `toolCallId`. Mutually exclusive: `result` on submit, `cancelled` on
 * skip/cancel.
 */
const SubmitHeteroInterventionSchema = z.object({
  cancelReason: z.enum(['timeout', 'user_cancelled', 'session_ended']).optional(),
  cancelled: z.boolean().optional(),
  operationId: z.string().min(1),
  result: z.unknown().optional(),
  /** Producer step index; harmless placeholder — correlation is by toolCallId. */
  stepIndex: z.number().int().nonnegative().default(0),
  toolCallId: z.string().min(1),
});

const aiAgentProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      agentRuntimeService: new AgentRuntimeService(ctx.serverDB, ctx.userId, {
        workspaceId: wsId,
      }),
      aiAgentService: new AiAgentService(ctx.serverDB, ctx.userId, { workspaceId: wsId }),
      aiChatService: new AiChatService(ctx.serverDB, ctx.userId, wsId),
      heterogeneousAgentService: new HeterogeneousAgentService(ctx.serverDB, ctx.userId, {
        workspaceId: wsId,
      }),
      messageModel: new MessageModel(ctx.serverDB, ctx.userId, wsId),
      threadModel: new ThreadModel(ctx.serverDB, ctx.userId, wsId),
      topicModel: new TopicModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

// Dedicated procedure for hetero-agent ingest/finish endpoints.
// Requires a `hetero-operation` JWT (4h expiry) — normal user tokens are rejected,
// so only the sandbox/device that received the JWT from execAgent can call these.
//
// Note: workspaceId is not on `ctx` for this procedure (the JWT is server-to-server
// and carries no workspace claim). Handlers must resolve wsId from the row keyed
// by `topicId` and construct `HeterogeneousAgentService` per request.
const heteroAgentProcedure = heteroAuthedProcedure.use(serverDatabase);
const aiAgentWriteProcedure = aiAgentProcedure.use(withScopedPermission('message:create'));

export const aiAgentRouter = router({
  /**
   * Create Thread for client-side task execution in Group mode
   *
   * This endpoint is specifically designed for Group Chat scenarios where:
   * - Messages in the thread may have different agentIds (supervisor, workers)
   * - The subAgentId is the worker agent that executes the task
   * - Thread messages query should not filter by agentId to include all parent messages
   */
  createClientGroupAgentTaskThread: aiAgentWriteProcedure
    .input(CreateClientGroupAgentTaskThreadSchema)
    .mutation(async ({ input, ctx }) => {
      const { groupId, instruction, parentMessageId, subAgentId, title, topicId } = input;

      log('createClientGroupAgentTaskThread: subAgentId=%s, groupId=%s', subAgentId, groupId);

      try {
        // 1. Create Thread for isolated task execution
        // Use subAgentId as the thread's agentId (the executing agent)
        const startedAt = new Date().toISOString();
        const thread = await ctx.threadModel.create({
          agentId: subAgentId,
          groupId,
          metadata: { clientMode: true, startedAt },
          sourceMessageId: parentMessageId,
          status: ThreadStatus.Processing,
          title,
          topicId,
          type: ThreadType.Isolation,
        });

        if (!thread) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create thread for task execution',
          });
        }

        log('createClientGroupAgentTaskThread: created thread %s', thread.id);

        // 2. Create initial user message (persisted to database)
        // Use subAgentId as the message's agentId
        const userMessage = await ctx.messageModel.create({
          agentId: subAgentId,
          content: instruction,
          groupId,
          parentId: parentMessageId,
          role: 'user',
          threadId: thread.id,
          topicId,
        });

        log('createClientGroupAgentTaskThread: created user message %s', userMessage.id);

        // 3. Query thread messages and main chat messages in parallel
        const messageQueryOptions = {
          postProcessUrl: createUiMessageFileUrlResolver(),
        };
        const [threadMessages, messages] = await Promise.all([
          // Thread messages (messages within this thread)
          // DON'T pass agentId - thread query fetches parent messages via sourceMessageId
          // which may have different agentIds (supervisor vs worker in group chat)
          ctx.messageModel.query({ threadId: thread.id, topicId }, messageQueryOptions),
          // Main chat messages (messages without threadId)
          // Only filter by groupId + topicId (not agentId) to include all agents' messages
          ctx.messageModel.query({ groupId, topicId }, messageQueryOptions),
        ]);

        log(
          'createClientGroupAgentTaskThread: queried %d thread messages, %d main messages',
          threadMessages.length,
          messages.length,
        );

        // 4. Return Thread, userMessageId, threadMessages and messages
        return {
          messages,
          startedAt,
          success: true,
          threadId: thread.id,
          threadMessages,
          userMessageId: userMessage.id,
        };
      } catch (error: any) {
        log('createClientGroupAgentTaskThread failed: %O', error);

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to create client group agent task thread: ${error.message}`,
        });
      }
    }),

  /**
   * Create Thread for client-side task execution
   *
   * This endpoint is called by desktop client when runInClient=true.
   * It creates the Thread but does NOT execute the task - execution happens on client side.
   */
  createClientTaskThread: aiAgentWriteProcedure
    .input(CreateClientTaskThreadSchema)
    .mutation(async ({ input, ctx }) => {
      const { agentId, groupId, instruction, parentMessageId, title, topicId } = input;

      log('createClientTaskThread: agentId=%s, groupId=%s', agentId, groupId);

      try {
        // 1. Create Thread for isolated task execution
        const startedAt = new Date().toISOString();
        const thread = await ctx.threadModel.create({
          agentId,
          groupId,
          metadata: { clientMode: true, startedAt },
          sourceMessageId: parentMessageId,
          status: ThreadStatus.Processing,
          title,
          topicId,
          type: ThreadType.Isolation,
        });

        if (!thread) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create thread for task execution',
          });
        }

        log('createClientTaskThread: created thread %s', thread.id);

        // 2. Create initial user message (persisted to database)
        const userMessage = await ctx.messageModel.create({
          agentId,
          content: instruction,
          groupId,
          parentId: parentMessageId,
          role: 'user',
          threadId: thread.id,
          topicId,
        });

        log('createClientTaskThread: created user message %s', userMessage.id);

        // 3. Query thread messages and main chat messages in parallel
        const messageQueryOptions = {
          postProcessUrl: createUiMessageFileUrlResolver(),
        };
        const [threadMessages, messages] = await Promise.all([
          // Thread messages (messages within this thread)
          ctx.messageModel.query({ agentId, threadId: thread.id, topicId }, messageQueryOptions),
          // Main chat messages (messages without threadId, includes updated taskDetail)
          // Pass both agentId and groupId - query() prioritizes groupId when present
          ctx.messageModel.query({ agentId, groupId, topicId }, messageQueryOptions),
        ]);

        log(
          'createClientTaskThread: queried %d thread messages, %d main messages',
          threadMessages.length,
          messages.length,
        );

        // 4. Return Thread, userMessageId, threadMessages and messages
        return {
          messages,
          startedAt,
          success: true,
          threadId: thread.id,
          threadMessages,
          userMessageId: userMessage.id,
        };
      } catch (error: any) {
        log('createClientTaskThread failed: %O', error);

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to create client task thread: ${error.message}`,
        });
      }
    }),

  execAgent: aiAgentWriteProcedure.input(ExecAgentSchema).mutation(async ({ input, ctx }) => {
    const {
      agentId,
      slug,
      prompt,
      appContext,
      autoStart = true,
      deviceId,
      existingMessageIds = [],
      fileIds,
      mentionedAgents,
      parentMessageId,
      resumeApproval,
      resumeToolResult,
      selectedToolIds,
      trigger,
      userInterventionConfig,
    } = input;

    log('execAgent: identifier=%s, prompt=%s', agentId || slug, prompt.slice(0, 50));

    try {
      return await ctx.aiAgentService.execAgent({
        agentId,
        appContext,
        autoStart,
        deviceId,
        existingMessageIds,
        fileIds,
        mentionedAgents,
        parentMessageId,
        prompt,
        // When parentMessageId is provided, this is a regeneration/continue or a
        // human-approval resume — either way, skip user message creation.
        resume: !!parentMessageId,
        resumeApproval,
        resumeToolResult,
        selectedToolIds,
        slug,
        trigger: trigger ?? RequestTrigger.Chat,
        userInterventionConfig,
      });
    } catch (error: any) {
      console.error('execAgent failed: %O', error);

      if (error instanceof TRPCError) {
        throw error;
      }

      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to execute agent: ${error.message}`,
      });
    }
  }),

  /**
   * Batch execute multiple agents
   * Supports parallel or sequential execution
   */
  execAgents: aiAgentWriteProcedure.input(ExecAgentsSchema).mutation(async ({ input, ctx }) => {
    const { tasks, parallel = true } = input;

    log('execAgents: %d tasks, parallel=%s', tasks.length, parallel);

    type TaskResult = {
      autoStarted?: boolean;
      error?: string;
      operationId?: string;
      success: boolean;
      taskIndex: number;
    };

    const executeTask = async (
      task: (typeof tasks)[number],
      taskIndex: number,
    ): Promise<TaskResult> => {
      const {
        agentId,
        slug,
        prompt,
        appContext,
        autoStart = true,
        deviceId,
        existingMessageIds = [],
        parentMessageId,
        trigger,
      } = task;

      try {
        const result = await ctx.aiAgentService.execAgent({
          agentId,
          appContext,
          autoStart,
          deviceId,
          existingMessageIds,
          parentMessageId,
          prompt,
          // When parentMessageId is provided, this is a regeneration/continue — skip user message creation
          resume: !!parentMessageId,
          slug,
          trigger: trigger ?? RequestTrigger.Chat,
        });

        return {
          autoStarted: result.autoStarted,
          operationId: result.operationId,
          success: true,
          taskIndex,
        };
      } catch (error: any) {
        log('execAgents task %d failed: %O', taskIndex, error);

        return {
          error: error.message || 'Unknown error',
          success: false,
          taskIndex,
        };
      }
    };

    // Execute tasks with pMap for concurrency control
    // parallel=true: concurrency of 5, parallel=false: sequential (concurrency of 1)
    const concurrency = parallel ? 5 : 1;

    const results = await pMap(tasks, (task, index) => executeTask(task, index), { concurrency });

    // Calculate summary
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return {
      results,
      success: failed === 0,
      summary: {
        failed,
        succeeded,
        total: tasks.length,
      },
    };
  }),

  /**
   * Execute Group Agent (Supervisor) in a single call
   *
   * This endpoint combines message creation and agent execution:
   * 1. Create topic (if needed)
   * 2. Create user message
   * 3. Create assistant message placeholder
   * 4. Trigger Supervisor Agent execution
   * 5. Return operationId for SSE connection + messages for UI sync
   */
  execGroupAgent: aiAgentWriteProcedure
    .input(ExecGroupAgentSchema)
    .mutation(async ({ input, ctx }) => {
      const { agentId, groupId, message, files, topicId, newTopic } = input;

      log('execGroupAgent: agentId=%s, groupId=%s', agentId, groupId);

      try {
        // Execute group agent
        const result = await ctx.aiAgentService.execGroupAgent({
          agentId,
          files,
          groupId,
          message,
          newTopic,
          topicId,
        });

        // Get messages and topics for UI sync
        // Messages include the assistant message with error if operation failed to start
        const { messages, topics } = await ctx.aiChatService.getMessagesAndTopics({
          agentId,
          groupId,
          includeTopic: result.isCreateNewTopic,
          topicId: result.topicId,
        });

        // Return result with messages/topics - includes error/success fields
        // Frontend can check success to decide whether to connect to SSE stream
        return { ...result, messages, topics };
      } catch (error: any) {
        log('execGroupAgent failed: %O', error);

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to execute group agent: ${error.message}`,
        });
      }
    }),

  /**
   * Execute SubAgent task (supports both Group and Single Agent mode)
   *
   * This endpoint is called by Supervisor (Group mode) or Agent (Single mode)
   * to delegate tasks to SubAgents. Each task runs in an isolated Thread context.
   *
   * - Group mode: pass groupId, Thread will be associated with the Group
   * - Single Agent mode: omit groupId, Thread will only be associated with the Agent
   */
  execSubAgentTask: aiAgentWriteProcedure
    .input(ExecSubAgentTaskSchema)
    .mutation(async ({ input, ctx }) => {
      const { agentId, groupId, instruction, parentMessageId, title, topicId, timeout } = input;

      log('execSubAgentTask: agentId=%s, groupId=%s', agentId, groupId);

      try {
        // External procedure name stays `execSubAgentTask`; the service method is `execSubAgent`.
        return await ctx.aiAgentService.execSubAgent({
          agentId,
          groupId,
          instruction,
          parentMessageId,
          timeout,
          title,
          topicId,
        });
      } catch (error: any) {
        log('execSubAgentTask failed: %O', error);

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to execute sub-agent task: ${error.message}`,
        });
      }
    }),

  getOperationStatus: aiAgentProcedure
    .input(GetOperationStatusSchema)
    .query(async ({ input, ctx }) => {
      const { historyLimit, includeHistory, operationId } = input;

      if (!operationId) {
        throw new Error('operationId parameter is required');
      }

      log('Getting operation status for %s', operationId);

      // Get operation status using AgentRuntimeService
      const operationStatus = await ctx.agentRuntimeService.getOperationStatus({
        historyLimit,
        includeHistory,
        operationId,
      });

      return operationStatus;
    }),

  getPendingInterventions: aiAgentProcedure
    .input(GetPendingInterventionsSchema)
    .query(async ({ input, ctx }) => {
      const { operationId, userId } = input;

      log('Getting pending interventions for operationId: %s, userId: %s', operationId, userId);

      // Get pending interventions using AgentRuntimeService
      const result = await ctx.agentRuntimeService.getPendingInterventions({
        operationId: operationId || undefined,
        userId: userId || undefined,
      });

      return result;
    }),

  /**
   * Get SubAgent task execution status
   *
   * This endpoint queries the status of a SubAgent task by threadId.
   * It queries from Thread table (PostgreSQL) for persistence,
   * and supplements with real-time status from Redis if available.
   *
   * Works for both Group mode and Single Agent mode tasks.
   *
   * IMPORTANT: In QStash queue mode, step lifecycle callbacks cannot fire
   * because each HTTP request creates a new AgentRuntimeService instance.
   * As a workaround, this endpoint also updates Thread metadata from Redis
   * when real-time status is available.
   */
  getSubAgentTaskStatus: aiAgentProcedure
    .input(
      z.object({
        /** Thread ID */
        threadId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { threadId } = input;

      log('getSubAgentTaskStatus: threadId=%s', threadId);

      // 1. Find thread by threadId
      const thread = await ctx.threadModel.findById(threadId);

      if (!thread) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Thread not found',
        });
      }

      // 2. Map Thread status to task status
      const threadStatusToTaskStatus: Record<string, TaskStatusResult['status']> = {
        [ThreadStatus.Active]: 'processing',
        [ThreadStatus.Cancel]: 'cancel',
        [ThreadStatus.Completed]: 'completed',
        [ThreadStatus.Failed]: 'failed',
        [ThreadStatus.InReview]: 'processing',
        [ThreadStatus.Pending]: 'processing',
        [ThreadStatus.Processing]: 'processing',
        [ThreadStatus.Todo]: 'processing',
      };

      const taskStatus = threadStatusToTaskStatus[thread.status] || 'processing';
      const metadata = thread.metadata;

      // 3. Try to get real-time status from Redis (for active tasks)
      // Note: This is optional - Redis operation may be expired or unavailable.
      // Thread table is the persistent source of truth.
      let realtimeStatus: Awaited<ReturnType<typeof ctx.agentRuntimeService.getOperationStatus>> =
        null;
      const resolvedOperationId = metadata?.operationId;
      if (resolvedOperationId && taskStatus === 'processing') {
        realtimeStatus = await ctx.agentRuntimeService.getOperationStatus({
          operationId: resolvedOperationId,
        });

        // 4. WORKAROUND for QStash mode: Update Thread metadata from Redis
        // In QStash mode, step callbacks don't fire because each HTTP request
        // creates a new AgentRuntimeService instance with empty callback map.
        // So we update Thread metadata here when polling for status.
        // Note: realtimeStatus may be null if operation expired from Redis
        if (realtimeStatus) {
          const redisState = realtimeStatus.currentState;
          const updatedMetadata: Record<string, any> = {
            ...metadata,
            operationId: resolvedOperationId,
          };

          // Update metrics from Redis state using currentState and stats
          if (redisState.usage) {
            updatedMetadata.totalTokens = redisState.usage.llm?.tokens?.total;
            updatedMetadata.totalToolCalls = redisState.usage.tools?.totalCalls;
          }
          if (redisState.cost?.total !== undefined) {
            updatedMetadata.totalCost = redisState.cost.total;
          }

          // Use stats for totalMessages (currentState doesn't include messages array)
          const { stats } = realtimeStatus;
          if (stats?.totalMessages) {
            updatedMetadata.totalMessages = stats.totalMessages;
          }

          // Store totalSteps from stepCount
          if (redisState.stepCount) {
            updatedMetadata.totalSteps = redisState.stepCount;
          }

          // Check if operation is completed
          if (realtimeStatus.isCompleted || redisState.status === 'done') {
            updatedMetadata.completedAt = new Date().toISOString();
            if (metadata?.startedAt) {
              updatedMetadata.duration = Date.now() - new Date(metadata.startedAt).getTime();
            }

            // Update thread status to completed
            await ctx.threadModel.update(threadId, {
              metadata: updatedMetadata,
              status: ThreadStatus.Completed,
            });

            log('getSubAgentTaskStatus: marked thread %s as completed', threadId);
          } else if (realtimeStatus.hasError || redisState.status === 'error') {
            // Normalize nested runtime errors so task metadata keeps a readable message.
            const formattedError = formatTaskError(redisState.error);

            updatedMetadata.error = formattedError;
            updatedMetadata.completedAt = new Date().toISOString();
            if (metadata?.startedAt) {
              updatedMetadata.duration = Date.now() - new Date(metadata.startedAt).getTime();
            }

            log('getSubAgentTaskStatus: error formatting for thread %s: %O', threadId, {
              originalError: redisState.error,
              formattedError,
            });

            await ctx.threadModel.update(threadId, {
              metadata: updatedMetadata,
              status: ThreadStatus.Failed,
            });
            log('getSubAgentTaskStatus: marked thread %s as failed', threadId);
          } else {
            // Still processing, just update metrics
            await ctx.threadModel.update(threadId, {
              metadata: updatedMetadata,
            });
            log('getSubAgentTaskStatus: updated thread %s metadata', threadId);
          }
        } else {
          // Redis status not available (expired), use Thread data only
          log(
            'getSubAgentTaskStatus: Redis operation %s expired, using Thread data only',
            resolvedOperationId,
          );
        }
      }

      // 5. Re-fetch thread to get updated metadata
      const updatedThread = await ctx.threadModel.findById(threadId);
      const updatedMetadata = updatedThread?.metadata ?? metadata;
      const updatedStatus = updatedThread?.status ?? thread.status;
      const updatedTaskStatus = threadStatusToTaskStatus[updatedStatus] || 'processing';

      if (updatedTaskStatus === 'failed') {
        log('getSubAgentTaskStatus: returning failed task status for thread %s: %O', threadId, {
          updatedMetadata,
          error: updatedMetadata?.error,
          updatedStatus,
        });
      }

      // 6. Query thread messages for result content or current activity
      const threadMessages = await ctx.messageModel.query(
        { threadId },
        {
          postProcessUrl: createUiMessageFileUrlResolver(),
        },
      );
      const sortedMessages = threadMessages.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      // 6.1 Parse messages using conversation-flow for UI display
      const { flatList: parsedMessages } = parse(threadMessages);

      // 7. Get result content when task is completed or failed
      let resultContent: string | undefined;
      if (updatedTaskStatus === 'completed' || updatedTaskStatus === 'failed') {
        const lastAssistantMessage = sortedMessages.find((m) => m.role === 'assistant');
        resultContent = lastAssistantMessage?.content;
      }

      // 8. Build currentActivity when task is processing
      let currentActivity: TaskCurrentActivity | undefined;
      if (updatedTaskStatus === 'processing' && sortedMessages.length > 0) {
        const lastMessage = sortedMessages[0];

        if (lastMessage.role === 'tool') {
          // Tool message means tool has returned result
          currentActivity = {
            apiName: lastMessage.plugin?.apiName ?? undefined,
            contentPreview: lastMessage.content?.slice(0, 100),
            identifier: lastMessage.plugin?.identifier ?? undefined,
            type: 'tool_result',
          };
        } else if (lastMessage.role === 'assistant') {
          // Check if assistant is calling tools
          const tools = lastMessage.tools as Array<{
            apiName?: string;
            identifier?: string;
          }> | null;
          if (tools && tools.length > 0) {
            const lastTool = tools.at(-1);
            currentActivity = {
              apiName: lastTool?.apiName,
              identifier: lastTool?.identifier,
              type: 'tool_calling',
            };
          } else {
            // Assistant is generating content
            currentActivity = {
              contentPreview: lastMessage.content?.slice(0, 100),
              type: 'generating',
            };
          }
        }
      }

      // 9. Build TaskDetail from Thread (uses ThreadStatus)
      const taskDetail = {
        completedAt: updatedMetadata?.completedAt,
        duration: updatedMetadata?.duration,
        error: updatedMetadata?.error,
        startedAt: updatedMetadata?.startedAt,
        status: updatedStatus,
        threadId: thread.id,
        title: thread.title,
        totalCost: updatedMetadata?.totalCost,
        totalMessages: updatedMetadata?.totalMessages,
        totalSteps: updatedMetadata?.totalSteps,
        totalTokens: updatedMetadata?.totalTokens,
        totalToolCalls: updatedMetadata?.totalToolCalls,
      };

      // 10. Build result
      const result: TaskStatusResult = {
        completedAt: updatedMetadata?.completedAt,
        cost:
          realtimeStatus?.currentState?.cost ??
          (updatedMetadata?.totalCost ? { total: updatedMetadata.totalCost } : undefined),
        currentActivity,
        error: updatedMetadata?.error ?? realtimeStatus?.currentState?.error,
        messages: parsedMessages,
        result: resultContent,
        status: updatedTaskStatus,
        stepCount: realtimeStatus?.currentState?.stepCount,
        taskDetail,
        usage:
          realtimeStatus?.currentState?.usage ??
          (updatedMetadata?.totalTokens
            ? { total_tokens: updatedMetadata.totalTokens }
            : undefined),
      };

      return result;
    }),

  /**
   * Interrupt a running task
   *
   * This endpoint interrupts a SubAgent task by threadId or operationId.
   * It updates both operation status and Thread status to cancelled state.
   */
  interruptTask: aiAgentWriteProcedure
    .input(InterruptTaskSchema)
    .mutation(async ({ input, ctx }) => {
      const { threadId, operationId, topicId } = input;

      log('interruptTask: threadId=%s, operationId=%s, topicId=%s', threadId, operationId, topicId);

      try {
        return await ctx.aiAgentService.interruptTask({ operationId, threadId, topicId });
      } catch (error: any) {
        if (error.message === 'Thread not found') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Thread not found' });
        }
        if (error.message === 'Operation ID not found') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Operation ID not found' });
        }
        throw error;
      }
    }),

  /**
   * Ingest a batch of `AgentStreamEvent`s from a `lh hetero exec` producer
   * (CLI standalone, sandboxed CC, etc.) and republish them through the
   * existing stream fanout so renderer-side gateway WS subscribers see them
   * unchanged. Phase 2a: pub/sub only — no DB persistence (phase 2b adds it).
   */
  heteroIngest: heteroAgentProcedure.input(HeteroIngestSchema).mutation(async ({ input, ctx }) => {
    const { agentType, assistantMessageId, events, operationId, topicId } = input;

    log(
      'heteroIngest: topic=%s op=%s type=%s count=%d',
      topicId,
      operationId,
      agentType,
      events.length,
    );

    try {
      // Resolve workspaceId from the topic row so persistence writes land in
      // the correct workspace scope. heteroAuthedProcedure carries no
      // workspace claim, so we must look it up here per request. We bypass
      // `TopicModel.findById` because it filters by workspace; here we need a
      // workspace-agnostic lookup keyed only by topicId + userId.
      const [topicRow] = await ctx.serverDB
        .select({ workspaceId: topics.workspaceId })
        .from(topics)
        .where(and(eq(topics.id, topicId), eq(topics.userId, ctx.userId)))
        .limit(1);

      // Owner-token callers (a logged-in desktop reusing its own session) must
      // prove they own the target topic — `topicRow` is already filtered by
      // `userId`, so a missing row means the topic isn't theirs. The
      // operation-token path is exempt: its `sub` may be a workspaceId that
      // never matches `topics.userId`, and it's trusted as server-minted.
      if (ctx.heteroAuthKind === 'user' && !topicRow) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Topic not found or not owned by the caller',
        });
      }

      const wsId = topicRow?.workspaceId ?? undefined;
      const heteroService = new HeterogeneousAgentService(ctx.serverDB, ctx.userId, {
        workspaceId: wsId,
      });

      // Zod's z.any() infers `data?: any`, but the wire shape always includes
      // a `data` field (may be null). Cast at the boundary instead of widening
      // the shared `AgentStreamEvent` type or the service signature.
      await heteroService.heteroIngest({
        agentType,
        assistantMessageId,
        events: events as AgentStreamEvent[],
        operationId,
        topicId,
      });
      return { ack: true as const };
    } catch (error: any) {
      // Preserve deliberate auth errors (e.g. the ownership FORBIDDEN) instead
      // of masking them as a generic 500.
      if (error instanceof TRPCError) throw error;
      log('heteroIngest failed: %s', error?.message);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: error?.message || 'Failed to ingest heterogeneous agent events',
      });
    }
  }),

  /**
   * Terminal handshake from a `lh hetero exec` producer: signals process exit
   * and carries the run's high-level outcome. Always emits a final
   * `agent_runtime_end` so renderer subscribers can shut down even when the
   * CLI's own end-event was lost mid-flight.
   */
  heteroFinish: heteroAgentProcedure.input(HeteroFinishSchema).mutation(async ({ input, ctx }) => {
    const { agentType, error, operationId, result, sessionId, topicId } = input;

    log('heteroFinish: topic=%s op=%s type=%s result=%s', topicId, operationId, agentType, result);

    try {
      // Resolve workspaceId from the topic row (heteroAuthedProcedure has no
      // workspace claim) so persistence writes land in the correct scope.
      const [topicRow] = await ctx.serverDB
        .select({ workspaceId: topics.workspaceId })
        .from(topics)
        .where(and(eq(topics.id, topicId), eq(topics.userId, ctx.userId)))
        .limit(1);

      // See heteroIngest: owner tokens must own the topic; operation tokens are exempt.
      if (ctx.heteroAuthKind === 'user' && !topicRow) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Topic not found or not owned by the caller',
        });
      }

      const wsId = topicRow?.workspaceId ?? undefined;
      const heteroService = new HeterogeneousAgentService(ctx.serverDB, ctx.userId, {
        workspaceId: wsId,
      });

      // heteroFinish now owns the full terminal transition: it fires the run's
      // onComplete/onError hooks through the shared hookDispatcher, which drives
      // the task lifecycle (onTopicComplete) and any IM bot completion callback —
      // the same mechanism the normal LLM runtime uses. No bespoke lifecycle call
      // here anymore; this is just the server-to-server ack endpoint.
      await heteroService.heteroFinish({
        agentType,
        error,
        operationId,
        result,
        sessionId,
        topicId,
      });

      return { ack: true as const };
    } catch (err: any) {
      // Preserve deliberate auth errors (e.g. the ownership FORBIDDEN) instead
      // of masking them as a generic 500.
      if (err instanceof TRPCError) throw err;
      log('heteroFinish failed: %s', err?.message);
      throw new TRPCError({
        cause: err,
        code: 'INTERNAL_SERVER_ERROR',
        message: err?.message || 'Failed to finalize heterogeneous agent run',
      });
    }
  }),

  /**
   * Exec-side long-poll for remote Human-in-the-loop (op-JWT auth, same as
   * `heteroIngest`). The `lh hetero exec` producer — which holds only an
   * op-scoped JWT + tRPC and never the server's Redis — pulls
   * `agent_intervention_response` events off the op's Redis stream through this
   * server-mediated read, then resolves its in-process `AskUserBridge`. One
   * bounded `XREAD BLOCK` per call; the producer loops while a pending is in
   * flight, threading `lastEventId` forward so nothing is missed between polls.
   */
  waitInterventionResponse: heteroAgentProcedure
    .input(WaitInterventionResponseSchema)
    .query(async ({ input, ctx }) => {
      const { operationId, lastEventId, blockMs } = input;

      // Ownership guard, mirroring heteroIngest / heteroFinish. The op stream is
      // read by `operationId` alone, so an owner-token caller (a logged-in
      // desktop reusing its own OIDC session) must prove it owns THIS operation
      // — otherwise any signed-in user could long-poll another run's
      // `agent_intervention_response` payloads by id. Bind the guard to the
      // operation row directly (tighter than the topic-level guard the write
      // paths use, since the read has no topicId to key on). The operation-token
      // path is exempt: it's server-minted and handed only to the sandbox /
      // device running this op.
      if (ctx.heteroAuthKind === 'user') {
        const [operationRow] = await ctx.serverDB
          .select({ userId: agentOperations.userId })
          .from(agentOperations)
          .where(eq(agentOperations.id, operationId))
          .limit(1);

        if (operationRow?.userId !== ctx.userId) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Operation not found or not owned by the caller',
          });
        }
      }

      const streamEventManager = createStreamEventManager();
      const { events, lastEventId: nextEventId } = await streamEventManager.readEventsOnce(
        operationId,
        lastEventId,
        blockMs,
      );

      // Only intervention responses matter to the producer; everything else on
      // the stream is already going out via its own outbound ingest path.
      return {
        events: events.filter((e) => e.type === 'agent_intervention_response'),
        lastEventId: nextEventId,
      };
    }),

  /**
   * Browser leg of remote Human-in-the-loop (user auth). Publishes the user's
   * answer to an `agent_intervention_request` back onto the op's Redis stream
   * as an `agent_intervention_response`. Two consumers converge on it by
   * `toolCallId`: the renderer (card → resolved) and the exec long-poll
   * (`waitInterventionResponse` → `bridge.resolve`). Symmetric with the
   * desktop path, which resolves the bridge over Electron IPC instead.
   */
  submitHeteroIntervention: aiAgentWriteProcedure
    .input(SubmitHeteroInterventionSchema)
    .mutation(async ({ input }) => {
      const { operationId, toolCallId, stepIndex, result, cancelled, cancelReason } = input;

      log(
        'submitHeteroIntervention: op=%s toolCallId=%s cancelled=%s',
        operationId,
        toolCallId,
        cancelled ?? false,
      );

      const streamEventManager = createStreamEventManager();
      await streamEventManager.publishStreamEvent(operationId, {
        data: {
          cancelReason: cancelled ? (cancelReason ?? 'user_cancelled') : undefined,
          cancelled,
          result: cancelled ? undefined : result,
          toolCallId,
        },
        stepIndex,
        type: 'agent_intervention_response',
      });

      return { success: true as const };
    }),

  processHumanIntervention: aiAgentWriteProcedure
    .input(ProcessHumanInterventionSchema)
    .mutation(async ({ input, ctx }) => {
      const { operationId, action, data, reason, stepIndex, toolMessageId } = input;

      log(`Processing ${action} for operation ${operationId}`);

      // Build intervention parameters
      const interventionParams: any = {
        action,
        operationId,
        stepIndex,
        toolMessageId,
      };

      switch (action) {
        case 'approve': {
          if (!data?.approvedToolCall) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'approvedToolCall is required for approve action',
            });
          }
          interventionParams.approvedToolCall = data.approvedToolCall;
          // toolMessageId is required for the server to persist the
          // intervention + short-circuit into call_tool; the handler itself
          // no-ops when missing, so keep the schema permissive for legacy
          // callers that haven't been updated yet.
          break;
        }
        case 'reject':
        case 'reject_continue': {
          interventionParams.rejectionReason = reason || 'Tool call rejected by user';
          interventionParams.rejectAndContinue = action === 'reject_continue';
          break;
        }
        case 'input': {
          if (!data?.input) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'input is required for input action',
            });
          }
          interventionParams.humanInput = { response: data.input };
          break;
        }
        case 'select': {
          if (!data?.selection) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'selection is required for select action',
            });
          }
          interventionParams.humanInput = { selection: data.selection };
          break;
        }
      }

      // Process human intervention using AgentRuntimeService
      const result = await ctx.agentRuntimeService.processHumanIntervention(interventionParams);

      return {
        action,
        message: `Human intervention processed successfully. Execution resumed.`,
        operationId,
        scheduledMessageId: result.messageId,
        success: true,
        timestamp: new Date().toISOString(),
      };
    }),

  startExecution: aiAgentWriteProcedure
    .input(StartExecutionSchema)
    .mutation(async ({ input, ctx }) => {
      const { operationId, context, priority, delay } = input;

      log('Starting execution for operation %s', operationId);

      // Start execution using AgentRuntimeService
      const result = await ctx.agentRuntimeService.startExecution({
        context,
        delay,
        operationId,
        priority,
      });

      return {
        ...result,
        message: 'Agent execution started successfully',
        timestamp: new Date().toISOString(),
      };
    }),

  /**
   * Update Thread status after client-side task execution completes
   *
   * This endpoint is called by desktop client after task execution finishes.
   * It updates the Thread status and metadata similar to server-side completion.
   */
  updateClientTaskThreadStatus: aiAgentWriteProcedure
    .input(UpdateClientTaskThreadStatusSchema)
    .mutation(async ({ input, ctx }) => {
      const { threadId, completionReason, error, resultContent, metadata } = input;

      log('updateClientTaskThreadStatus: threadId=%s, reason=%s', threadId, completionReason);

      try {
        // Find thread
        const thread = await ctx.threadModel.findById(threadId);
        if (!thread) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Thread not found',
          });
        }

        const completedAt = new Date().toISOString();
        const startedAt = thread.metadata?.startedAt;
        const duration = startedAt ? Date.now() - new Date(startedAt).getTime() : undefined;

        // Determine thread status based on completion reason
        let status: ThreadStatus;
        switch (completionReason) {
          case 'done': {
            status = ThreadStatus.Completed;
            break;
          }
          case 'error': {
            status = ThreadStatus.Failed;
            break;
          }
          case 'interrupted': {
            status = ThreadStatus.Cancel;
            break;
          }
          default: {
            status = ThreadStatus.Completed;
          }
        }

        // Update Thread metadata and status
        await ctx.threadModel.update(threadId, {
          metadata: {
            ...thread.metadata,
            completedAt,
            duration,
            error: error || undefined,
            totalCost: metadata?.totalCost,
            totalMessages: metadata?.totalMessages,
            totalSteps: metadata?.totalSteps,
            totalTokens: metadata?.totalTokens,
            totalToolCalls: metadata?.totalToolCalls,
          },
          status,
        });

        // Update task message (sourceMessageId) with result content if provided
        if (resultContent && thread.sourceMessageId) {
          await ctx.messageModel.update(thread.sourceMessageId, {
            content: resultContent,
          });
          log(
            'updateClientTaskThreadStatus: updated task message %s with result',
            thread.sourceMessageId,
          );
        }

        log('updateClientTaskThreadStatus: thread %s completed with status %s', threadId, status);

        return {
          status,
          success: true,
          threadId,
        };
      } catch (error: any) {
        log('updateClientTaskThreadStatus failed: %O', error);

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to update client task thread status: ${error.message}`,
        });
      }
    }),

  /**
   * Refresh Gateway JWT token for an existing operation.
   * Used when reconnecting after page reload (original token expired).
   */
  refreshGatewayToken: aiAgentProcedure
    .input(z.object({ topicId: z.string() }))
    .query(async ({ input, ctx }) => {
      // Verify the topic belongs to this user and has a running operation
      const topic = await ctx.topicModel.findById(input.topicId);

      if (!topic?.metadata?.runningOperation) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No running operation found on this topic',
        });
      }

      const token = await signUserJWT(ctx.userId);

      return { token };
    }),
});
