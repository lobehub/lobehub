import type { AgentRuntimeContext, AgentState } from '@lobechat/agent-runtime';
import { type LobeChatDatabase } from '@lobechat/database';
import type {
  ExecAgentParams,
  ExecAgentResult,
  ExecGroupAgentParams,
  ExecGroupAgentResult,
  ExecSubAgentTaskParams,
  ExecSubAgentTaskResult,
} from '@lobechat/types';
import { ThreadStatus, ThreadType } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import debug from 'debug';

import { LOADING_FLAT } from '@/const/message';
import { AgentModel } from '@/database/models/agent';
import { MessageModel } from '@/database/models/message';
import { PluginModel } from '@/database/models/plugin';
import { ThreadModel } from '@/database/models/thread';
import { TopicModel } from '@/database/models/topic';
import {
  type ServerAgentToolsContext,
  createServerAgentToolsEngine,
  serverMessagesEngine,
} from '@/server/modules/Mecha';
import { AgentRuntimeService } from '@/server/services/agentRuntime';
import type { StepLifecycleCallbacks } from '@/server/services/agentRuntime/types';

const log = debug('lobe-server:ai-agent-service');

/**
 * Internal params for execAgent with step lifecycle callbacks
 * This extends the public ExecAgentParams with server-side only options
 */
interface InternalExecAgentParams extends ExecAgentParams {
  /** Step lifecycle callbacks for operation tracking (server-side only) */
  stepCallbacks?: StepLifecycleCallbacks;
}

/**
 * AI Agent Service
 *
 * Encapsulates agent execution logic that can be triggered via:
 * - tRPC router (aiAgent.execAgent)
 * - REST API endpoint (/api/agent)
 * - Cron jobs / scheduled tasks
 */
export class AiAgentService {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;
  private readonly agentModel: AgentModel;
  private readonly messageModel: MessageModel;
  private readonly pluginModel: PluginModel;
  private readonly threadModel: ThreadModel;
  private readonly topicModel: TopicModel;
  private readonly agentRuntimeService: AgentRuntimeService;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
    this.agentModel = new AgentModel(db, userId);
    this.messageModel = new MessageModel(db, userId);
    this.pluginModel = new PluginModel(db, userId);
    this.threadModel = new ThreadModel(db, userId);
    this.topicModel = new TopicModel(db, userId);
    this.agentRuntimeService = new AgentRuntimeService(db, userId);
  }

  /**
   * Execute agent with just a prompt
   *
   * This is a simplified API that requires agent identifier (id or slug) and prompt.
   * All necessary data (agent config, tools, messages) will be fetched from the database.
   *
   * Architecture:
   * execAgent({ agentId | slug, prompt })
   *   → AgentModel.getAgentConfig(idOrSlug)
   *   → ServerMechaModule.AgentToolsEngine(config)
   *   → ServerMechaModule.ContextEngineering(input, config, messages)
   *   → AgentRuntimeService.createOperation(...)
   */
  async execAgent(params: InternalExecAgentParams): Promise<ExecAgentResult> {
    const {
      agentId,
      slug,
      prompt,
      appContext,
      autoStart = true,
      existingMessageIds = [],
      stepCallbacks,
    } = params;

    // Validate that either agentId or slug is provided
    if (!agentId && !slug) {
      throw new Error('Either agentId or slug must be provided');
    }

    // Determine the identifier to use (agentId takes precedence)
    const identifier = agentId || slug!;

    log('execAgent: identifier=%s, prompt=%s', identifier, prompt.slice(0, 50));

    // 1. Get agent configuration from database (supports both id and slug)
    const agentConfig = await this.agentModel.getAgentConfig(identifier);
    if (!agentConfig) {
      throw new Error(`Agent not found: ${identifier}`);
    }

    // Use actual agent ID from config for subsequent operations
    const resolvedAgentId = agentConfig.id;

    log('execAgent: got agent config for %s (id: %s)', identifier, resolvedAgentId);

    // 2. Handle topic creation: if no topicId provided, create a new topic; otherwise reuse existing
    let topicId = appContext?.topicId;
    if (!topicId) {
      const newTopic = await this.topicModel.create({
        agentId: resolvedAgentId,
        title: prompt.slice(0, 50) + (prompt.length > 50 ? '...' : ''),
      });
      topicId = newTopic.id;
      log('execAgent: created new topic %s', topicId);
    } else {
      log('execAgent: reusing existing topic %s', topicId);
    }

    // Extract model and provider from agent config
    const model = agentConfig.model!;
    const provider = agentConfig.provider!;

    // 3. Get installed plugins from database
    const installedPlugins = await this.pluginModel.query();
    log('execAgent: got %d installed plugins', installedPlugins.length);

    // 4. Get model abilities from model-bank for function calling support check
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');
    const modelInfo = LOBE_DEFAULT_MODEL_LIST.find(
      (m) => m.id === model && m.providerId === provider,
    );
    const isModelSupportToolUse = (m: string, p: string) => {
      const info = LOBE_DEFAULT_MODEL_LIST.find((item) => item.id === m && item.providerId === p);
      return info?.abilities?.functionCall ?? true;
    };

    // 5. Create tools using Server AgentToolsEngine
    const hasEnabledKnowledgeBases =
      agentConfig.knowledgeBases?.some((kb: { enabled?: boolean | null }) => kb.enabled === true) ??
      false;

    const toolsContext: ServerAgentToolsContext = {
      installedPlugins,
      isModelSupportToolUse,
    };

    const toolsEngine = createServerAgentToolsEngine(toolsContext, {
      agentConfig: {
        chatConfig: agentConfig.chatConfig ?? undefined,
        plugins: agentConfig.plugins ?? undefined,
      },
      hasEnabledKnowledgeBases,
      model,
      provider,
    });

    // Generate tools and manifest map
    const pluginIds = agentConfig.plugins || [];
    const toolsResult = toolsEngine.generateToolsDetailed({
      model,
      provider,
      toolIds: pluginIds,
    });

    const tools = toolsResult.tools;

    // Get manifest map and convert from Map to Record
    const manifestMap = toolsEngine.getEnabledPluginManifests(pluginIds);
    const toolManifestMap: Record<string, any> = {};
    manifestMap.forEach((manifest, id) => {
      toolManifestMap[id] = manifest;
    });

    log('execAgent: generated %d tools', tools?.length ?? 0);

    // 6. Get existing messages if provided
    let historyMessages: any[] = [];
    if (existingMessageIds.length > 0) {
      historyMessages = await this.messageModel.query({
        sessionId: appContext?.sessionId,
        topicId: appContext?.topicId ?? undefined,
      });
      if (existingMessageIds.length > 0) {
        const idSet = new Set(existingMessageIds);
        historyMessages = historyMessages.filter((msg) => idSet.has(msg.id));
      }
    }

    // 7. Create user message in database
    const userMessageRecord = await this.messageModel.create({
      agentId: resolvedAgentId,
      content: prompt,
      role: 'user',
      topicId,
    });
    log('execAgent: created user message %s', userMessageRecord.id);

    // 8. Create assistant message placeholder in database
    const assistantMessageRecord = await this.messageModel.create({
      agentId: resolvedAgentId,
      content: LOADING_FLAT,
      model,
      parentId: userMessageRecord.id,
      provider,
      role: 'assistant',
      topicId,
    });
    log('execAgent: created assistant message %s', assistantMessageRecord.id);

    // Create user message object for processing
    const userMessage = { content: prompt, role: 'user' as const };

    // Combine history messages with user message
    const allMessages = [...historyMessages, userMessage];

    // 9. Process messages using Server ContextEngineering
    const processedMessages = await serverMessagesEngine({
      capabilities: {
        isCanUseFC: isModelSupportToolUse,
        isCanUseVideo: () => modelInfo?.abilities?.video ?? false,
        isCanUseVision: () => modelInfo?.abilities?.vision ?? true,
      },
      enableHistoryCount: agentConfig.chatConfig?.enableHistoryCount ?? undefined,
      historyCount: agentConfig.chatConfig?.historyCount ?? undefined,
      knowledge: {
        fileContents: agentConfig.files
          ?.filter((f: { enabled?: boolean | null }) => f.enabled === true)
          .map((f: { content?: string | null; id?: string; name?: string }) => ({
            content: f.content ?? '',
            fileId: f.id ?? '',
            filename: f.name ?? '',
          })),
        knowledgeBases: agentConfig.knowledgeBases
          ?.filter((kb: { enabled?: boolean | null }) => kb.enabled === true)
          .map((kb: { id?: string; name?: string }) => ({
            id: kb.id ?? '',
            name: kb.name ?? '',
          })),
      },
      messages: allMessages,
      model,
      provider,
      systemRole: agentConfig.systemRole ?? undefined,
      toolsConfig: {
        tools: pluginIds,
      },
    });

    log('execAgent: processed %d messages', processedMessages.length);

    // 10. Generate operation ID: agt_{timestamp}_{agentId}_{topicId}_{random}
    const timestamp = Date.now();
    const operationId = `op_${timestamp}_${resolvedAgentId}_${topicId}_${nanoid(8)}`;

    // 11. Create initial context
    const initialContext: AgentRuntimeContext = {
      payload: {
        // Pass assistant message ID so agent runtime knows which message to update
        assistantMessageId: assistantMessageRecord.id,
        isFirstMessage: true,
        message: [{ content: prompt }],
        // Pass user message ID as parentMessageId for reference
        parentMessageId: userMessageRecord.id,
        // Include tools for initial LLM call
        tools,
      },
      phase: 'user_input' as const,
      session: {
        messageCount: processedMessages.length,
        sessionId: operationId,
        status: 'idle' as const,
        stepCount: 0,
      },
    };

    // 12. Create operation using AgentRuntimeService
    // Wrap in try-catch to handle operation startup failures (e.g., QStash unavailable)
    // If createOperation fails, we still have valid messages that need error info
    try {
      const result = await this.agentRuntimeService.createOperation({
        agentConfig,
        appContext: {
          agentId: resolvedAgentId,
          groupId: appContext?.groupId,
          threadId: appContext?.threadId,
          topicId,
        },
        autoStart,
        initialContext,
        initialMessages: processedMessages,
        modelRuntimeConfig: { model, provider },
        operationId,
        stepCallbacks,
        toolManifestMap,
        tools,
        userId: this.userId,
      });

      log('execAgent: created operation %s (autoStarted: %s)', operationId, result.autoStarted);

      return {
        agentId: resolvedAgentId,
        assistantMessageId: assistantMessageRecord.id,
        autoStarted: result.autoStarted,
        createdAt: new Date().toISOString(),
        message: 'Agent operation created successfully',
        messageId: result.messageId,
        operationId,
        status: 'created',
        success: true,
        timestamp: new Date().toISOString(),
        topicId,
        userMessageId: userMessageRecord.id,
      };
    } catch (error) {
      // Operation startup failed (e.g., QStash queue service unavailable)
      // Update assistant message with error so user can see what went wrong
      const errorMessage = error instanceof Error ? error.message : 'Unknown error starting agent';
      log(
        'execAgent: createOperation failed, updating assistant message with error: %s',
        errorMessage,
      );

      await this.messageModel.update(assistantMessageRecord.id, {
        content: '',
        error: {
          body: {
            detail: errorMessage,
          },
          message: errorMessage,
          type: 'ServerAgentRuntimeError', // ServiceUnavailable - agent runtime service unavailable
        },
      });

      // Return result with error status - messages are valid but agent didn't start
      return {
        agentId: resolvedAgentId,
        assistantMessageId: assistantMessageRecord.id,
        autoStarted: false,
        createdAt: new Date().toISOString(),
        error: errorMessage,
        message: 'Agent operation failed to start',
        operationId,
        status: 'error',
        success: false,
        timestamp: new Date().toISOString(),
        topicId,
        userMessageId: userMessageRecord.id,
      };
    }
  }

  /**
   * Execute Group Agent (Supervisor) in a single call
   *
   * This method handles Group-specific logic (topic with groupId) and delegates
   * the core agent execution to execAgent.
   *
   * Flow:
   * 1. Create topic with groupId (if needed)
   * 2. Delegate to execAgent for the rest
   */
  async execGroupAgent(params: ExecGroupAgentParams): Promise<ExecGroupAgentResult> {
    const { agentId, groupId, message, topicId: inputTopicId, newTopic } = params;

    log(
      'execGroupAgent: agentId=%s, groupId=%s, message=%s',
      agentId,
      groupId,
      message.slice(0, 50),
    );

    // 1. Create topic with groupId if needed
    let topicId = inputTopicId;
    let isCreateNewTopic = false;

    // Create new topic when:
    // - newTopic is explicitly provided, OR
    // - no topicId is provided (default behavior for group chat)
    if (newTopic || !inputTopicId) {
      const topicTitle =
        newTopic?.title || message.slice(0, 50) + (message.length > 50 ? '...' : '');
      const topicItem = await this.topicModel.create({
        agentId,
        groupId,
        messages: newTopic?.topicMessageIds,
        title: topicTitle,
      });
      topicId = topicItem.id;
      isCreateNewTopic = true;
      log('execGroupAgent: created new topic %s with groupId %s', topicId, groupId);
    }

    // 2. Delegate to execAgent with groupId in appContext
    const result = await this.execAgent({
      agentId,
      appContext: { groupId, topicId },
      autoStart: true,
      prompt: message,
    });

    log(
      'execGroupAgent: delegated to execAgent, operationId=%s, success=%s',
      result.operationId,
      result.success,
    );

    return {
      assistantMessageId: result.assistantMessageId,
      error: result.error,
      isCreateNewTopic,
      operationId: result.operationId,
      success: result.success,
      topicId: result.topicId,
      userMessageId: result.userMessageId,
    };
  }

  /**
   * Execute SubAgent task (supports both Group and Single Agent mode)
   *
   * This method is called by Supervisor (Group mode) or Agent (Single mode)
   * to delegate tasks to SubAgents. Each task runs in an isolated Thread context.
   *
   * - Group mode: pass groupId, Thread will be associated with the Group
   * - Single Agent mode: omit groupId, Thread will only be associated with the Agent
   *
   * Flow:
   * 1. Create Thread (type='isolation', status='processing')
   * 2. Delegate to execAgent with threadId in appContext
   * 3. Store operationId in Thread metadata
   */
  async execSubAgentTask(params: ExecSubAgentTaskParams): Promise<ExecSubAgentTaskResult> {
    const { groupId, topicId, parentMessageId, agentId, instruction } = params;

    log(
      'execSubAgentTask: agentId=%s, groupId=%s, topicId=%s, instruction=%s',
      agentId,
      groupId,
      topicId,
      instruction.slice(0, 50),
    );

    // 1. Create Thread for isolated task execution
    const thread = await this.threadModel.create({
      agentId,
      groupId,
      sourceMessageId: parentMessageId,
      topicId,
      type: ThreadType.Isolation,
    });

    if (!thread) {
      throw new Error('Failed to create thread for task execution');
    }

    log('execSubAgentTask: created thread %s', thread.id);

    // 2. Update Thread status to processing with startedAt timestamp
    const startedAt = new Date().toISOString();
    await this.threadModel.update(thread.id, {
      metadata: { startedAt },
      status: ThreadStatus.Processing,
    });

    // 3. Create step lifecycle callbacks for updating Thread metadata and task message
    const stepCallbacks = this.createThreadMetadataCallbacks(thread.id, startedAt, parentMessageId);

    // 4. Delegate to execAgent with threadId in appContext and callbacks
    // The instruction will be created as user message in the Thread
    const result = await this.execAgent({
      agentId,
      appContext: { groupId, threadId: thread.id, topicId },
      autoStart: true,
      prompt: instruction,
      stepCallbacks,
    });

    log(
      'execSubAgentTask: delegated to execAgent, operationId=%s, success=%s',
      result.operationId,
      result.success,
    );

    // 5. Store operationId in Thread metadata
    await this.threadModel.update(thread.id, {
      metadata: { operationId: result.operationId, startedAt },
    });

    // 6. If operation failed to start, update thread status
    if (!result.success) {
      const completedAt = new Date().toISOString();
      await this.threadModel.update(thread.id, {
        metadata: {
          completedAt,
          duration: Date.now() - new Date(startedAt).getTime(),
          error: result.error,
          operationId: result.operationId,
          startedAt,
        },
        status: ThreadStatus.Failed,
      });
    }

    return {
      assistantMessageId: result.assistantMessageId,
      error: result.error,
      operationId: result.operationId,
      success: result.success ?? false,
      threadId: thread.id,
    };
  }

  /**
   * Create step lifecycle callbacks for updating Thread metadata
   * These callbacks accumulate metrics during execution and update Thread on completion
   *
   * @param threadId - The Thread ID to update
   * @param startedAt - The start time ISO string
   * @param sourceMessageId - The task message ID (sourceMessageId from Thread) to update with summary
   */
  private createThreadMetadataCallbacks(
    threadId: string,
    startedAt: string,
    sourceMessageId: string,
  ): StepLifecycleCallbacks {
    // Accumulator for tracking metrics across steps
    let accumulatedToolCalls = 0;

    return {
      onAfterStep: async ({ state, stepResult }) => {
        // Count tool calls from this step
        const toolCallsInStep = stepResult?.events?.filter(
          (e: { type: string }) => e.type === 'tool_call',
        )?.length;
        if (toolCallsInStep) {
          accumulatedToolCalls += toolCallsInStep;
        }

        // Update Thread metadata with current progress
        try {
          await this.threadModel.update(threadId, {
            metadata: {
              operationId: state.operationId,
              startedAt,
              totalMessages: state.messages?.length ?? 0,
              totalTokens: this.calculateTotalTokens(state.usage),
              totalToolCalls: accumulatedToolCalls,
            },
          });
          log(
            'execSubAgentTask: updated thread %s metadata after step %d',
            threadId,
            state.stepCount,
          );
        } catch (error) {
          log('execSubAgentTask: failed to update thread metadata: %O', error);
        }
      },

      onComplete: async ({ finalState, reason }) => {
        const completedAt = new Date().toISOString();
        const duration = Date.now() - new Date(startedAt).getTime();

        // Determine thread status based on completion reason
        let status: ThreadStatus;
        switch (reason) {
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
          case 'waiting_for_human': {
            status = ThreadStatus.InReview;
            break;
          }
          default: {
            status = ThreadStatus.Completed;
          }
        }

        try {
          // Extract summary from last assistant message and update task message content
          const lastAssistantMessage = finalState.messages
            ?.slice()
            .reverse()
            .find((m: { role: string }) => m.role === 'assistant');

          if (lastAssistantMessage?.content) {
            await this.messageModel.update(sourceMessageId, {
              content: lastAssistantMessage.content,
            });
            log('execSubAgentTask: updated task message %s with summary', sourceMessageId);
          }

          // Update Thread metadata
          await this.threadModel.update(threadId, {
            metadata: {
              completedAt,
              duration,
              error: finalState.error,
              operationId: finalState.operationId,
              startedAt,
              totalCost: finalState.cost?.total,
              totalMessages: finalState.messages?.length ?? 0,
              totalTokens: this.calculateTotalTokens(finalState.usage),
              totalToolCalls: accumulatedToolCalls,
            },
            status,
          });

          log(
            'execSubAgentTask: thread %s completed with status %s, reason: %s',
            threadId,
            status,
            reason,
          );
        } catch (error) {
          console.error('execSubAgentTask: failed to update thread on completion: %O', error);
        }
      },
    };
  }

  /**
   * Calculate total tokens from AgentState usage object
   * AgentState.usage is of type Usage from @lobechat/agent-runtime
   */
  private calculateTotalTokens(usage?: AgentState['usage']): number | undefined {
    if (!usage) return undefined;
    return usage.llm?.tokens?.total;
  }

  /**
   * Interrupt a running task
   *
   * This method interrupts a SubAgent task by threadId or operationId.
   * It updates both operation status and Thread status to cancelled state.
   */
  async interruptTask(params: {
    operationId?: string;
    threadId?: string;
  }): Promise<{ operationId?: string; success: boolean; threadId?: string }> {
    const { threadId, operationId } = params;

    log('interruptTask: threadId=%s, operationId=%s', threadId, operationId);

    // 1. Get operationId and thread
    let resolvedOperationId = operationId;
    let thread;

    if (threadId) {
      thread = await this.threadModel.findById(threadId);
      if (!thread) {
        throw new Error('Thread not found');
      }
      resolvedOperationId = resolvedOperationId || thread.metadata?.operationId;
    }

    if (!resolvedOperationId) {
      throw new Error('Operation ID not found');
    }

    // 2. Try to interrupt the operation
    // Note: AgentRuntimeService may not have interruptOperation method yet
    // We'll gracefully handle this case by only updating thread status
    try {
      // Check if the method exists before calling (using type assertion for future method)
      const service = this.agentRuntimeService as any;
      if (typeof service.interruptOperation === 'function') {
        await service.interruptOperation({
          operationId: resolvedOperationId,
        });
      } else {
        log('interruptTask: interruptOperation method not available, only updating thread status');
      }
    } catch (error: any) {
      log('interruptTask: Failed to interrupt operation: %O', error);
      // Continue to update Thread status even if operation interrupt fails
    }

    // 3. Update Thread status to cancel
    if (thread) {
      await this.threadModel.update(thread.id, {
        metadata: {
          ...thread.metadata,
          completedAt: new Date().toISOString(),
        },
        status: ThreadStatus.Cancel,
      });
    }

    return {
      operationId: resolvedOperationId,
      success: true,
      threadId: thread?.id,
    };
  }
}
