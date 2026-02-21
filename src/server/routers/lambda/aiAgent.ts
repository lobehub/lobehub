import { type AgentRuntimeContext } from '@lobechat/agent-runtime';
import { parse } from '@lobechat/conversation-flow';
import { type TaskCurrentActivity, type TaskStatusResult } from '@lobechat/types';
import { ThreadStatus, ThreadType } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import pMap from 'p-map';
import { z } from 'zod';

import { MessageModel } from '@/database/models/message';
import { ThreadModel } from '@/database/models/thread';
import { TopicModel } from '@/database/models/topic';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AgentRuntimeService } from '@/server/services/agentRuntime';
import { AiAgentService } from '@/server/services/aiAgent';
import { AiChatService } from '@/server/services/aiChat';
import { nanoid } from '@/utils/uuid';

const log = debug('lobe-server:ai-agent-router');

// Zod schemas for agent operation
const CreateAgentOperationSchema = z.object({
  agentConfig: z.record(z.any()).optional().default({}),
  agentId: z.string().optional(),
  autoStart: z.boolean().optional().default(true),
  messages: z.array(z.any()).optional().default([]),
  modelRuntimeConfig: z.object({
    model: z.string(),
    provider: z.string(),
  }),
  threadId: z.string().optional().nullable(),
  toolManifestMap: z.record(z.string(), z.any()).default({}),
  tools: z.array(z.any()).optional(),
  topicId: z.string().optional().nullable(),
  userId: z.string().optional(),
});

const GetOperationStatusSchema = z.object({
  historyLimit: z.number().optional().default(10),
  includeHistory: z.boolean().optional().default(false),
  operationId: z.string(),
});

const ProcessHumanInterventionSchema = z.object({
  action: z.enum(['approve', 'reject', 'input', 'select']),
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
        groupId: z.string().optional().nullable(),
        scope: z.string().optional().nullable(),
        sessionId: z.string().optional(),
        threadId: z.string().optional().nullable(),
        topicId: z.string().optional().nullable(),
      })
      .optional(),
    /** Whether to auto-start execution after creating operation */
    autoStart: z.boolean().optional().default(true),
    /** Optional existing message IDs to include in context */
    existingMessageIds: z.array(z.string()).optional().default([]),
    /** The user input/prompt */
    prompt: z.string(),
    /** The agent slug to run (either agentId or slug is required) */
    slug: z.string().optional(),
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
  topicId: z.string().optional().nullable(),
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
  })
  .refine((data) => data.threadId || data.operationId, {
    message: 'Either threadId or operationId must be provided',
  });

const aiAgentProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      agentRuntimeService: new AgentRuntimeService(ctx.serverDB, ctx.userId),
      aiAgentService: new AiAgentService(ctx.serverDB, ctx.userId),
      aiChatService: new AiChatService(ctx.serverDB, ctx.userId),
      messageModel: new MessageModel(ctx.serverDB, ctx.userId),
      threadModel: new ThreadModel(ctx.serverDB, ctx.userId),
      topicModel: new TopicModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const aiAgentRouter = router({
  /**
   * Create Thread for client-side task execution in Group mode
   *
   * This endpoint is specifically designed for Group Chat scenarios where:
   * - Messages in the thread may have different agentIds (supervisor, workers)
   * - The subAgentId is the worker agent that executes the task
   * - Thread messages query should not filter by agentId to include all parent messages
   */
  createClientGroupAgentTaskThread: aiAgentProcedure
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
        const [threadMessages, messages] = await Promise.all([
          // Thread messages (messages within this thread)
          // DON'T pass agentId - thread query fetches parent messages via sourceMessageId
          // which may have different agentIds (supervisor vs worker in group chat)
          ctx.messageModel.query({ threadId: thread.id, topicId }),
          // Main chat messages (messages without threadId)
          // Only filter by groupId + topicId (not agentId) to include all agents' messages
          ctx.messageModel.query({ groupId, topicId }),
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
  createClientTaskThread: aiAgentProcedure
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
        const [threadMessages, messages] = await Promise.all([
          // Thread messages (messages within this thread)
          ctx.messageModel.query({ agentId, threadId: thread.id, topicId }),
          // Main chat messages (messages without threadId, includes updated taskDetail)
          // Pass both agentId and groupId - query() prioritizes groupId when present
          ctx.messageModel.query({ agentId, groupId, topicId }),
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

  createOperation: aiAgentProcedure
    .input(CreateAgentOperationSchema)
    .mutation(async ({ input, ctx }) => {
      const {
        agentConfig = {},
        agentId,
        autoStart = true,
        messages = [],
        modelRuntimeConfig,
        threadId,
        topicId,
        tools,
        toolManifestMap,
      } = input;
      log('input: %O', input);

      // Validate required parameters
      if (!modelRuntimeConfig.model || !modelRuntimeConfig.provider) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'modelRuntimeConfig.model and modelRuntimeConfig.provider are required',
        });
      }

      // Generate runtime operation ID: agt_{timestamp}_{agentId}_{topicId}_{random}
      const timestamp = Date.now();
      const operationId = `agt_${timestamp}_${agentId || 'unknown'}_${topicId || 'none'}_${nanoid(8)}`;

      log(`Creating operation ${operationId} for user ${ctx.userId}`);

      // Create initial context
      const initialContext: AgentRuntimeContext = {
        payload: {},
        phase: 'user_input' as const,
        session: {
          messageCount: messages.length,
          sessionId: operationId,
          status: 'idle' as const,
          stepCount: 0,
        },
      };

      // Create operation using AgentRuntimeService
      const result = await ctx.agentRuntimeService.createOperation({
        agentConfig,
        appContext: {
          agentId,
          threadId,
          topicId,
        },
        autoStart,
        initialContext,
        initialMessages: messages,
        modelRuntimeConfig,
        operationId,
        toolManifestMap,
        tools,
        userId: ctx.userId,
      });

      let firstStepResult;
      if (result.autoStarted) {
        firstStepResult = {
          context: initialContext,
          messageId: result.messageId,
          scheduled: true,
        };

        log(
          `Operation ${operationId} created and first step scheduled (messageId: ${result.messageId})`,
        );
      } else {
        log(`Operation ${operationId} created without auto-start`);
      }

      return {
        autoStart,
        createdAt: new Date().toISOString(),
        firstStep: firstStepResult,
        operationId,
        status: 'created',
        success: true,
      };
    }),

  execAgent: aiAgentProcedure.input(ExecAgentSchema).mutation(async ({ input, ctx }) => {
    const { agentId, slug, prompt, appContext, autoStart = true, existingMessageIds = [] } = input;

    log('execAgent: identifier=%s, prompt=%s', agentId || slug, prompt.slice(0, 50));

    try {
      return await ctx.aiAgentService.execAgent({
        agentId,
        appContext,
        autoStart,
        existingMessageIds,
        prompt,
        slug,
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
  execAgents: aiAgentProcedure.input(ExecAgentsSchema).mutation(async ({ input, ctx }) => {
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
      const { agentId, slug, prompt, appContext, autoStart = true, existingMessageIds = [] } = task;

      try {
        const result = await ctx.aiAgentService.execAgent({
          agentId,
          appContext,
          autoStart,
          existingMessageIds,
          prompt,
          slug,
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
  execGroupAgent: aiAgentProcedure.input(ExecGroupAgentSchema).mutation(async ({ input, ctx }) => {
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
  execSubAgentTask: aiAgentProcedure
    .input(ExecSubAgentTaskSchema)
    .mutation(async ({ input, ctx }) => {
      const { agentId, groupId, instruction, parentMessageId, title, topicId, timeout } = input;

      log('execSubAgentTask: agentId=%s, groupId=%s', agentId, groupId);

      try {
        return await ctx.aiAgentService.execSubAgentTask({
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
            updatedMetadata.error = redisState.error;
            updatedMetadata.completedAt = new Date().toISOString();
            if (metadata?.startedAt) {
              updatedMetadata.duration = Date.now() - new Date(metadata.startedAt).getTime();
            }

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

      // DEBUG: Log metadata for failed tasks
      if (updatedTaskStatus === 'failed') {
        console.log('[DEBUG] getSubAgentTaskStatus - failed task metadata:', {
          threadId,
          updatedMetadata,
          'updatedMetadata?.error': updatedMetadata?.error,
          updatedStatus,
        });
      }

      // 6. Query thread messages for result content or current activity
      const threadMessages = await ctx.messageModel.query({ threadId });
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
  interruptTask: aiAgentProcedure.input(InterruptTaskSchema).mutation(async ({ input, ctx }) => {
    const { threadId, operationId } = input;

    log('interruptTask: threadId=%s, operationId=%s', threadId, operationId);

    try {
      return await ctx.aiAgentService.interruptTask({ operationId, threadId });
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

  processHumanIntervention: aiAgentProcedure
    .input(ProcessHumanInterventionSchema)
    .mutation(async ({ input, ctx }) => {
      const { operationId, action, data, reason, stepIndex } = input;

      log(`Processing ${action} for operation ${operationId}`);

      // Build intervention parameters
      const interventionParams: any = {
        action,
        operationId,
        stepIndex,
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
          break;
        }
        case 'reject': {
          interventionParams.rejectionReason = reason || 'Tool call rejected by user';
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

  startExecution: aiAgentProcedure.input(StartExecutionSchema).mutation(async ({ input, ctx }) => {
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
  updateClientTaskThreadStatus: aiAgentProcedure
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
});
