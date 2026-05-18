import type { AgentRuntimeContext, AgentState } from '@lobechat/agent-runtime';
import type {
  AgenticAttempt,
  BaseAction,
  ExecutorResult,
  SignalAttempt,
} from '@lobechat/agent-signal';
import { MemoryApiName, MemoryIdentifier } from '@lobechat/builtin-tool-memory';
import type { LobeToolManifest, ToolExecutor, ToolSource } from '@lobechat/context-engine';
import {
  createAgentSignalMemoryWriterPrompt,
  createAgentSignalMemoryWriterSystemRole,
} from '@lobechat/prompts';
import { LayersEnum, RequestTrigger } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';

import { PluginModel } from '@/database/models/plugin';
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

const MEMORY_AGENT_MAX_STEPS = 8;

const MEMORY_WRITE_API_NAMES = [
  MemoryApiName.addActivityMemory,
  MemoryApiName.addContextMemory,
  MemoryApiName.addExperienceMemory,
  MemoryApiName.addIdentityMemory,
  MemoryApiName.addPreferenceMemory,
  MemoryApiName.removeIdentityMemory,
  MemoryApiName.updateIdentityMemory,
] as const;

const MEMORY_WRITE_TOOL_NAMES = new Set(
  MEMORY_WRITE_API_NAMES.map((apiName) => `${MemoryIdentifier}/${apiName}`),
);

const MEMORY_WRITE_API_NAME_SET = new Set<string>(MEMORY_WRITE_API_NAMES);
const MEMORY_WRITE_TARGET_BY_API_NAME: Record<string, { idKey: string; layer: LayersEnum }> = {
  [MemoryApiName.addActivityMemory]: { idKey: 'activityId', layer: LayersEnum.Activity },
  [MemoryApiName.addContextMemory]: { idKey: 'contextId', layer: LayersEnum.Context },
  [MemoryApiName.addExperienceMemory]: { idKey: 'experienceId', layer: LayersEnum.Experience },
  [MemoryApiName.addIdentityMemory]: { idKey: 'identityId', layer: LayersEnum.Identity },
  [MemoryApiName.addPreferenceMemory]: { idKey: 'preferenceId', layer: LayersEnum.Preference },
  [MemoryApiName.removeIdentityMemory]: { idKey: 'identityId', layer: LayersEnum.Identity },
  [MemoryApiName.updateIdentityMemory]: { idKey: 'identityId', layer: LayersEnum.Identity },
};
const TOOL_NAME_SEPARATOR = '____';

export interface MemoryActionTarget {
  id?: string;
  memoryId?: string;
  memoryLayer?: LayersEnum;
  summary?: string;
  title: string;
  type: 'memory';
}

export interface MemoryAgentActionResult {
  detail?: string;
  status: 'applied' | 'failed' | 'skipped';
  target?: MemoryActionTarget;
}

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
  const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

  return (model: string, provider: string) => {
    const info = LOBE_DEFAULT_MODEL_LIST.find(
      (item) => item.id === model && item.providerId === provider,
    );

    return info?.abilities?.functionCall ?? true;
  };
};

const hasSuccessfulMemoryWrite = (state: AgentState) => {
  const byTool = state.usage?.tools?.byTool ?? [];

  return byTool.some(
    (entry) => MEMORY_WRITE_TOOL_NAMES.has(entry.name) && entry.calls > entry.errors,
  );
};

const hasFailedMemoryWrite = (state: AgentState) => {
  const byTool = state.usage?.tools?.byTool ?? [];

  return byTool.some(
    (entry) =>
      MEMORY_WRITE_TOOL_NAMES.has(entry.name) && entry.calls > 0 && entry.calls === entry.errors,
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getString = (value: unknown) => {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
};

const parseToolArguments = (value: unknown): Record<string, unknown> | undefined => {
  if (isRecord(value)) return value;

  if (typeof value !== 'string') return;

  try {
    const parsed: unknown = JSON.parse(value);

    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return;
  }
};

interface MemoryToolCallSnapshot {
  apiName?: string;
  arguments?: unknown;
  id?: string;
  identifier?: string;
}

const getToolCallsFromMessage = (message: unknown): MemoryToolCallSnapshot[] => {
  if (!isRecord(message)) return [];

  const toolCalls: MemoryToolCallSnapshot[] = [];
  const persistedTools = Array.isArray(message.tools) ? message.tools : [];

  for (const tool of persistedTools) {
    if (!isRecord(tool)) continue;

    toolCalls.push({
      apiName: getString(tool.apiName),
      arguments: tool.arguments,
      id: getString(tool.id),
      identifier: getString(tool.identifier),
    });
  }

  const rawToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

  for (const toolCall of rawToolCalls) {
    if (!isRecord(toolCall)) continue;

    const fn = isRecord(toolCall.function) ? toolCall.function : undefined;
    const name = getString(fn?.name);
    if (!name) continue;

    const [identifier, apiName] = name.split(TOOL_NAME_SEPARATOR);

    toolCalls.push({
      apiName: apiName || name,
      arguments: fn?.arguments,
      id: getString(toolCall.id),
      identifier: apiName ? identifier : undefined,
    });
  }

  return toolCalls;
};

const isMemoryWriteToolCall = (
  toolCall: MemoryToolCallSnapshot,
): toolCall is MemoryToolCallSnapshot & { apiName: string } => {
  if (!toolCall.apiName || !MEMORY_WRITE_API_NAME_SET.has(toolCall.apiName)) return false;

  return !toolCall.identifier || toolCall.identifier === MemoryIdentifier;
};

const getToolMessageCallId = (message: unknown) => {
  if (!isRecord(message)) return;

  const plugin = isRecord(message.plugin) ? message.plugin : undefined;

  return getString(message.tool_call_id) ?? getString(plugin?.id);
};

const getMemoryIdsFromToolMessage = (message: unknown) => {
  if (!isRecord(message)) return;

  const ids: Record<string, string> = {};
  const addId = (key: string, value: unknown) => {
    if (!key.endsWith('Id')) return;

    const id = getString(value);
    if (id) ids[key] = id;
  };

  const pluginState = isRecord(message.pluginState) ? message.pluginState : undefined;
  if (pluginState) {
    for (const [key, value] of Object.entries(pluginState)) {
      addId(key, value);
    }
  }

  const content = getString(message.content);
  if (content) {
    for (const match of content.matchAll(/([A-Za-z]\w*Id):\s*"([^"]+)"/g)) {
      addId(match[1], match[2]);
    }
  }

  return Object.keys(ids).length > 0 ? ids : undefined;
};

const getMemoryToolResultIds = (state: AgentState) => {
  const resultIds = new Map<string, Record<string, string>>();

  for (const message of state.messages ?? []) {
    const callId = getToolMessageCallId(message);
    const ids = getMemoryIdsFromToolMessage(message);

    if (callId && ids) resultIds.set(callId, ids);
  }

  return resultIds;
};

const getNestedString = (payload: Record<string, unknown>, keys: string[]) => {
  let current: unknown = payload;

  for (const key of keys) {
    if (!isRecord(current)) return;

    current = current[key];
  }

  return getString(current);
};

const getToolArgumentString = (args: Record<string, unknown>, key: string) => {
  return getString(args[key]) ?? getNestedString(args, ['set', key]);
};

const createTargetFromToolArguments = (
  args: Record<string, unknown>,
  toolCall: MemoryToolCallSnapshot & { apiName: string },
  resultIds?: Record<string, string>,
): MemoryActionTarget | undefined => {
  const title = getToolArgumentString(args, 'title');
  if (!title) return;

  const targetConfig = MEMORY_WRITE_TARGET_BY_API_NAME[toolCall.apiName];
  const id = targetConfig ? resultIds?.[targetConfig.idKey] : undefined;
  const memoryId = resultIds?.memoryId;
  const summary =
    getToolArgumentString(args, 'summary') ??
    getToolArgumentString(args, 'details') ??
    getNestedString(args, ['withPreference', 'conclusionDirectives']);

  return {
    ...((id ?? memoryId) ? { id: id ?? memoryId } : {}),
    ...(memoryId ? { memoryId } : {}),
    ...(targetConfig ? { memoryLayer: targetConfig.layer } : {}),
    ...(summary ? { summary } : {}),
    title,
    type: 'memory',
  };
};

export const resolveMemoryActionTargetFromState = (
  state: AgentState,
): MemoryActionTarget | undefined => {
  const resultIds = getMemoryToolResultIds(state);

  for (const message of [...(state.messages ?? [])].reverse()) {
    const toolCalls = getToolCallsFromMessage(message).reverse();

    for (const toolCall of toolCalls) {
      if (!isMemoryWriteToolCall(toolCall)) continue;
      if (!toolCall.id) continue;

      const confirmedResultIds = resultIds.get(toolCall.id);
      if (!confirmedResultIds) continue;

      const args = parseToolArguments(toolCall.arguments);
      if (!args) continue;

      const target = createTargetFromToolArguments(args, toolCall, confirmedResultIds);
      if (target) return target;
    }
  }
};

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
    topicId?: string;
  },
  options: UserMemoryActionHandlerOptions,
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
  const streamEventManager = new InMemoryStreamEventManager();
  const { AgentRuntimeService } =
    await import('@/server/services/agentRuntime/AgentRuntimeService');
  const runtimeService = new AgentRuntimeService(options.db, options.userId, {
    coordinatorOptions: {
      stateManager: new InMemoryAgentStateManager(),
      streamEventManager,
    },
    queueService: null,
    streamEventManager,
  });

  await runtimeService.createOperation({
    agentConfig: memoryRuntimeAgentConfig,
    appContext: {
      agentId: input.agentId,
      scope: 'chat',
      topicId: input.topicId ?? null,
      trigger: RequestTrigger.AgentSignal,
    },
    autoStart: false,
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
    userInterventionConfig: { approvalMode: 'headless' },
  });

  const finalState = await runtimeService.executeSync(operationId, {
    initialContext,
    maxSteps: MEMORY_AGENT_MAX_STEPS,
  });

  if (finalState.status === 'error') {
    return {
      detail: 'Memory action agent finished with an error.',
      status: 'failed',
    };
  }

  if (hasSuccessfulMemoryWrite(finalState)) {
    const target = resolveMemoryActionTargetFromState(finalState);

    return {
      ...(target?.summary ? { detail: target.summary } : {}),
      status: 'applied',
      ...(target ? { target } : {}),
    };
  }

  if (hasFailedMemoryWrite(finalState)) {
    return {
      detail: 'Memory tool call failed during memory action agent execution.',
      status: 'failed',
    };
  }

  return {
    detail: 'Memory action agent did not issue a durable memory write.',
    status: 'skipped',
  };
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
      topicId: typeof action.payload.topicId === 'string' ? action.payload.topicId : undefined,
    };
    const runner = options.memoryActionRunner ?? ((input) => runMemoryActionAgent(input, options));
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
