import type { AgentRuntimeContext } from '@lobechat/agent-runtime';
import type {
  AgenticAttempt,
  BaseAction,
  ExecutorResult,
  SignalAttempt,
} from '@lobechat/agent-signal';
import { MemoryIdentifier } from '@lobechat/builtin-tool-memory';
import type { LobeToolManifest, ToolExecutor, ToolSource } from '@lobechat/context-engine';
import {
  createAgentSignalMemoryWriterPrompt,
  createAgentSignalMemoryWriterSystemRole,
} from '@lobechat/prompts';
import { RequestTrigger, ThreadType } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';

import { PluginModel } from '@/database/models/plugin';
import { ThreadModel } from '@/database/models/thread';
import type { LobeChatDatabase } from '@/database/type';
import {
  InMemoryAgentStateManager,
  InMemoryStreamEventManager,
} from '@/server/modules/AgentRuntime';
import {
  createServerAgentToolsEngine,
  type InstalledPlugin,
  type ServerAgentToolsContext,
} from '@/server/modules/Mecha';
import { AgentService } from '@/server/services/agent';
import type { AgentSignalOperationMarker } from '@/server/services/agentSignal/operationMarker';

import type { RuntimeProcessorContext } from '../../../runtime/context';
import { defineActionHandler } from '../../../runtime/middleware';
import {
  createMemoryService,
  MemoryActionError,
} from '../../../services/selfIteration/tools/shared';
import { hasAppliedActionIdempotency, markAppliedActionIdempotency } from '../../actionIdempotency';
import type {
  ActionUserMemoryHandle,
  AgentSignalFeedbackDomainConflictPolicy,
  AgentSignalFeedbackEvidence,
  AgentSignalFeedbackSourceHints,
} from '../../types';
import { AGENT_SIGNAL_POLICY_ACTION_TYPES } from '../../types';
import {
  type MemoryActionTarget,
  type MemoryAgentActionResult,
  resolveMemoryActionResultFromState,
  resolveMemoryActionTargetFromState,
} from './memoryActionResult';

const MEMORY_AGENT_MAX_STEPS = 8;

// Backward-compatible re-export: the memory finalState helpers + result types
// now live in the dependency-light ./memoryActionResult module.
export type { MemoryActionTarget, MemoryAgentActionResult };
export { resolveMemoryActionResultFromState, resolveMemoryActionTargetFromState };

export interface UserMemoryActionHandlerOptions {
  agentService?: Pick<AgentService, 'getAgentConfig'>;
  db: LobeChatDatabase;
  memoryActionRunner?: (input: {
    agentId?: string;
    conflictPolicy?: AgentSignalFeedbackDomainConflictPolicy;
    evidence?: AgentSignalFeedbackEvidence[];
    feedbackHint?: 'not_satisfied' | 'satisfied';
    memoryLanguage?: string;
    message: string;
    reason?: string;
    serializedContext?: string;
    sourceHints?: AgentSignalFeedbackSourceHints;
    sourceMessageId?: string;
    topicId?: string;
  }) => Promise<MemoryAgentActionResult>;
  pluginModel?: Pick<PluginModel, 'query'>;
  userId: string;
}

const finalizeAttempt = (
  startedAt: number,
  status: SignalAttempt['status'],
): SignalAttempt | AgenticAttempt => ({
  completedAt: Date.now(),
  current: 1,
  startedAt,
  status,
});

const toExecutorError = (actionId: string, error: unknown, startedAt: number): ExecutorResult => {
  return {
    actionId,
    attempt: finalizeAttempt(startedAt, 'failed'),
    error: {
      cause: error,
      code: 'USER_MEMORY_EXECUTION_FAILED',
      message: error instanceof Error ? error.message : String(error),
    },
    status: 'failed',
  };
};

const isUserMemoryAction = (action: BaseAction): action is ActionUserMemoryHandle => {
  return action.actionType === AGENT_SIGNAL_POLICY_ACTION_TYPES.userMemoryHandle;
};

const createInitialContext = (operationId: string): AgentRuntimeContext => {
  return {
    payload: { message: [] },
    phase: 'user_input',
    session: {
      messageCount: 1,
      sessionId: operationId,
      status: 'idle',
      stepCount: 0,
    },
  };
};

const toManifestRecord = (manifestMap: Map<string, LobeToolManifest>) => {
  return Object.fromEntries(manifestMap) as Record<string, LobeToolManifest>;
};

const createFunctionCallSupportChecker = async () => {
  const { loadModels } = await import('@/business/client/model-bank/loadModels');
  const builtinModels = await loadModels();

  return (model: string, provider: string) => {
    const info = builtinModels.find((item) => item.id === model && item.providerId === provider);

    return info?.abilities?.functionCall ?? true;
  };
};

// Memory finalState parsing (tool-call/result walking, target resolution) lives
// in ./memoryActionResult — kept dependency-light so the completion path can
// reuse it without dragging this heavy module into its graph.

export const runMemoryActionAgent = async (
  input: {
    agentId?: string;
    conflictPolicy?: AgentSignalFeedbackDomainConflictPolicy;
    evidence?: AgentSignalFeedbackEvidence[];
    feedbackHint?: 'not_satisfied' | 'satisfied';
    memoryLanguage?: string;
    message: string;
    reason?: string;
    serializedContext?: string;
    sourceHints?: AgentSignalFeedbackSourceHints;
    /**
     * The assistant message id that triggered this memory action.
     * When provided together with topicId, a child thread is created
     * under this message so that memory-agent messages are isolated
     * from the main topic conversation.
     */
    sourceMessageId?: string;
    topicId?: string;
  },
  options: UserMemoryActionHandlerOptions,
  /**
   * When provided, the memory writer runs as an async (queued) execAgent run
   * instead of a blocking `executeSync`: the operation is enqueued with the
   * agent-signal marker stamped onto `appContext`, and the durable receipt is
   * projected later on the completion path. Returns immediately with an
   * `applied` (enqueued) status. Absent → the legacy synchronous path (still
   * used by the self-iteration tool primitives until they migrate in S4).
   */
  dispatch?: { marker: AgentSignalOperationMarker },
): Promise<MemoryAgentActionResult> => {
  if (!input.agentId) {
    return {
      detail: 'Missing agentId for memory action.',
      status: 'skipped',
    };
  }

  const agentService = options.agentService ?? new AgentService(options.db, options.userId);
  const pluginModel = options.pluginModel ?? new PluginModel(options.db, options.userId);
  const agentConfig = await agentService.getAgentConfig(input.agentId);
  const memoryLanguage = input.memoryLanguage ?? 'English';

  if (!agentConfig?.model || !agentConfig?.provider) {
    return {
      detail: 'Missing runnable agent config for memory action.',
      status: 'failed',
    };
  }

  const installedPlugins = (await pluginModel.query()) as InstalledPlugin[];
  const isModelSupportToolUse = await createFunctionCallSupportChecker();
  const toolsContext: ServerAgentToolsContext = {
    installedPlugins,
    isModelSupportToolUse,
  };

  const memoryToolsAgentConfig = {
    chatConfig: {
      runtimeEnv: agentConfig.chatConfig?.runtimeEnv,
      searchMode: agentConfig.chatConfig?.searchMode,
    },
    plugins: [MemoryIdentifier],
  };

  const memoryRuntimeAgentConfig = {
    ...agentConfig,
    plugins: [MemoryIdentifier],
    systemRole: createAgentSignalMemoryWriterSystemRole({ memoryLanguage }),
  };

  const toolsEngine = createServerAgentToolsEngine(toolsContext, {
    agentConfig: memoryToolsAgentConfig,
    globalMemoryEnabled: true,
    model: agentConfig.model,
    provider: agentConfig.provider,
  });

  const toolsResult = toolsEngine.generateToolsDetailed({
    model: agentConfig.model,
    provider: agentConfig.provider,
    skipDefaultTools: true,
    toolIds: [MemoryIdentifier],
  });

  if (!toolsResult.enabledToolIds.includes(MemoryIdentifier) || !toolsResult.tools?.length) {
    return {
      detail: 'Memory tool is not available for the memory action agent.',
      status: 'failed',
    };
  }

  const manifestMap = toolsEngine.getEnabledPluginManifests([MemoryIdentifier]);
  const operationId = `agent-signal-memory-${nanoid()}`;
  const initialContext = createInitialContext(operationId);
  const { AgentRuntimeService } =
    await import('@/server/services/agentRuntime/AgentRuntimeService');

  // Create a child thread under the triggering assistant message so that
  // memory-agent messages are isolated from the main topic conversation
  // instead of being flattened into it.
  let threadId: string | undefined;
  if (input.topicId && input.sourceMessageId) {
    try {
      const threadModel = new ThreadModel(options.db, options.userId);
      const thread = await threadModel.create({
        agentId: input.agentId,
        metadata: { operationId },
        sourceMessageId: input.sourceMessageId,
        title: 'Agent Signal Memory',
        topicId: input.topicId,
        type: ThreadType.Isolation,
      });
      threadId = thread?.id;
    } catch {
      // Non-fatal: fall back to writing into the main topic if thread creation fails.
    }
  }

  const createParams = {
    agentConfig: memoryRuntimeAgentConfig,
    initialContext,
    initialMessages: [
      {
        content: createAgentSignalMemoryWriterPrompt({ ...input, memoryLanguage }),
        role: 'user',
      },
    ],
    modelRuntimeConfig: {
      model: agentConfig.model,
      provider: agentConfig.provider,
    },
    operationId,
    toolSet: {
      enabledToolIds: toolsResult.enabledToolIds,
      executorMap: {} as Record<string, ToolExecutor>,
      manifestMap: toManifestRecord(manifestMap),
      sourceMap: {} as Record<string, ToolSource>,
      tools: toolsResult.tools,
    },
    userId: options.userId,
  };
  const baseAppContext = {
    agentId: input.agentId,
    scope: 'chat',
    sourceMessageId: input.sourceMessageId,
    threadId: threadId ?? null,
    topicId: input.topicId ?? null,
    trigger: RequestTrigger.AgentSignal,
  };

  // Async (queued execAgent) path: enqueue the run with the marker stamped onto
  // appContext (it lands in state.metadata.agentSignal), then return immediately.
  // The durable receipt is projected on the completion path from the run's
  // finalState — no blocking executeSync.
  if (dispatch) {
    const runtimeService = new AgentRuntimeService(options.db, options.userId);
    await runtimeService.createOperation({
      ...createParams,
      appContext: { ...baseAppContext, agentSignal: dispatch.marker },
      autoStart: true,
      userInterventionConfig: { approvalMode: 'headless' },
    });

    return { detail: 'Memory write enqueued.', status: 'applied' };
  }

  // Legacy synchronous path (self-iteration tool primitives, until S4).
  const streamEventManager = new InMemoryStreamEventManager();
  const runtimeService = new AgentRuntimeService(options.db, options.userId, {
    coordinatorOptions: {
      stateManager: new InMemoryAgentStateManager(),
      streamEventManager,
    },
    queueService: null,
    streamEventManager,
  });
  await runtimeService.createOperation({
    ...createParams,
    appContext: baseAppContext,
    autoStart: false,
    userInterventionConfig: { approvalMode: 'headless' },
  });

  const finalState = await runtimeService.executeSync(operationId, {
    initialContext,
    maxSteps: MEMORY_AGENT_MAX_STEPS,
  });

  return resolveMemoryActionResultFromState(finalState);
};

export const handleUserMemoryAction = async (
  action: BaseAction,
  options: UserMemoryActionHandlerOptions,
  context: RuntimeProcessorContext,
): Promise<ExecutorResult> => {
  const startedAt = Date.now();
  const idempotencyKey =
    'idempotencyKey' in action.payload && typeof action.payload.idempotencyKey === 'string'
      ? action.payload.idempotencyKey
      : undefined;

  try {
    if (await hasAppliedActionIdempotency(context, idempotencyKey)) {
      return {
        actionId: action.actionId,
        attempt: finalizeAttempt(startedAt, 'skipped'),
        detail: 'Action idempotency key already applied.',
        status: 'skipped',
      };
    }

    if (!isUserMemoryAction(action)) {
      return {
        actionId: action.actionId,
        attempt: finalizeAttempt(startedAt, 'skipped'),
        detail: 'Unsupported memory action.',
        status: 'skipped',
      };
    }

    const message =
      typeof action.payload.message === 'string' ? action.payload.message.trim() : undefined;

    if (!message) {
      return {
        actionId: action.actionId,
        attempt: finalizeAttempt(startedAt, 'skipped'),
        detail: 'Missing memory action message.',
        status: 'skipped',
      };
    }

    const feedbackHint =
      action.payload.feedbackHint === 'satisfied' || action.payload.feedbackHint === 'not_satisfied'
        ? action.payload.feedbackHint
        : undefined;
    const runnerInput = {
      agentId: typeof action.payload.agentId === 'string' ? action.payload.agentId : undefined,
      conflictPolicy:
        typeof action.payload.conflictPolicy === 'object' && action.payload.conflictPolicy
          ? action.payload.conflictPolicy
          : undefined,
      evidence: Array.isArray(action.payload.evidence) ? action.payload.evidence : undefined,
      feedbackHint,
      message,
      reason: typeof action.payload.reason === 'string' ? action.payload.reason : undefined,
      serializedContext:
        typeof action.payload.serializedContext === 'string'
          ? action.payload.serializedContext
          : undefined,
      sourceHints:
        typeof action.payload.sourceHints === 'object' && action.payload.sourceHints
          ? action.payload.sourceHints
          : undefined,
      // The assistant message that completed the turn — used to anchor the
      // memory-agent child thread under that message instead of the main topic.
      // Populated by planUserMemory via extractAssistantMessageIdFromSourceId;
      // absent for non-clientRuntimeComplete sources where no assistant boundary exists.
      sourceMessageId:
        typeof action.payload.assistantMessageId === 'string'
          ? action.payload.assistantMessageId
          : undefined,
      topicId: typeof action.payload.topicId === 'string' ? action.payload.topicId : undefined,
    };
    // Stamp the run so the completion path can project the memory receipt (the
    // memory write is now enqueued async, not resolved synchronously here).
    const marker: AgentSignalOperationMarker = {
      kind: 'memory',
      ...(runnerInput.sourceMessageId ? { anchorMessageId: runnerInput.sourceMessageId } : {}),
      sourceId: idempotencyKey ?? action.actionId,
      ...(runnerInput.topicId ? { topicId: runnerInput.topicId } : {}),
    };
    const runner =
      options.memoryActionRunner ?? ((input) => runMemoryActionAgent(input, options, { marker }));
    let memoryActionResult: MemoryAgentActionResult | undefined;
    const memoryService = createMemoryService({
      writeMemory: async () => {
        const result = await runner(runnerInput);
        memoryActionResult = result;

        if (result.status === 'applied') {
          return {
            memoryId: result.target?.id ?? idempotencyKey ?? action.actionId,
            summary: result.detail,
          };
        }

        throw new MemoryActionError(
          result.detail ?? 'Memory action agent did not apply a durable memory write.',
          result.status,
        );
      },
    });

    const result = await memoryService
      .writeMemory({
        evidenceRefs: [],
        idempotencyKey: idempotencyKey ?? action.actionId,
        input: {
          content: message,
          userId: options.userId,
        },
      })
      .then<MemoryAgentActionResult>((writeResult) => ({
        detail: writeResult.summary,
        status: 'applied',
        ...(memoryActionResult?.target ? { target: memoryActionResult.target } : {}),
      }))
      .catch((error: unknown): MemoryAgentActionResult => {
        if (error instanceof MemoryActionError) {
          return {
            detail: error.message,
            status: error.status,
          };
        }

        throw error;
      });

    if (result.status === 'applied') {
      await markAppliedActionIdempotency(context, idempotencyKey);

      return {
        actionId: action.actionId,
        attempt: finalizeAttempt(startedAt, 'succeeded'),
        detail: result.detail,
        ...(result.target ? { output: { target: result.target } } : {}),
        status: 'applied',
      };
    }

    if (result.status === 'failed') {
      return {
        ...toExecutorError(
          action.actionId,
          result.detail ?? 'Memory action agent failed.',
          startedAt,
        ),
        detail: result.detail,
      };
    }

    return {
      actionId: action.actionId,
      attempt: finalizeAttempt(startedAt, 'skipped'),
      detail: result.detail,
      status: 'skipped',
    };
  } catch (error) {
    return toExecutorError(action.actionId, error, startedAt);
  }
};

export const defineUserMemoryActionHandler = (options: UserMemoryActionHandlerOptions) => {
  return defineActionHandler(
    AGENT_SIGNAL_POLICY_ACTION_TYPES.userMemoryHandle,
    'handler.user-memory.handle',
    async (action, context: RuntimeProcessorContext) => {
      return handleUserMemoryAction(action, options, context);
    },
  );
};
