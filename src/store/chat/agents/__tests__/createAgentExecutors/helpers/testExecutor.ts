import { type AgentInstruction, type AgentState } from '@lobechat/agent-runtime';

import { DEFAULT_AGENT_CHAT_CONFIG, DEFAULT_AGENT_CONFIG } from '@/const/settings';
import { type ResolvedAgentConfig } from '@/services/chat/mecha';
import { createAgentExecutors } from '@/store/chat/agents/createAgentExecutors';
import { type OperationType } from '@/store/chat/slices/operation/types';
import { type ChatStore } from '@/store/chat/store';

/**
 * Create a mock ResolvedAgentConfig for testing
 */
const createMockResolvedAgentConfig = (): ResolvedAgentConfig => ({
  agentConfig: { ...DEFAULT_AGENT_CONFIG },
  chatConfig: { ...DEFAULT_AGENT_CHAT_CONFIG },
  isBuiltinAgent: false,
  plugins: [],
});

/**
 * Execute an executor with mock context
 *
 * @example
 * const result = await executeWithMockContext({
 *   executor: 'call_llm',
 *   instruction: createCallLLMInstruction(),
 *   state: createInitialState(),
 *   mockStore,
 *   context: { operationId: 'op_123', messageKey: 'session_topic', parentId: 'msg_456' }
 * });
 */
export const executeWithMockContext = async ({
  executor,
  instruction,
  state,
  mockStore,
  context,
  skipCreateFirstMessage = false,
}: {
  context: {
    agentId?: string;
    groupId?: string;
    messageKey: string;
    operationId: string;
    parentId: string;
    subAgentId?: string;
    topicId?: string | null;
  };
  executor: AgentInstruction['type'];
  instruction: AgentInstruction;
  mockStore: ChatStore;
  skipCreateFirstMessage?: boolean;
  state: AgentState;
}) => {
  // Ensure operation exists in store
  if (!mockStore.operations[context.operationId]) {
    mockStore.operations[context.operationId] = {
      abortController: new AbortController(),
      childOperationIds: [],
      context: {
        agentId: context.agentId || 'test-session',
        groupId: context.groupId,
        messageId: context.parentId,
        subAgentId: context.subAgentId,
        topicId: context.topicId !== undefined ? context.topicId : 'test-topic',
      },
      id: context.operationId,
      metadata: { startTime: Date.now() },
      status: 'running',
      type: 'execAgentRuntime' as OperationType,
    };
  }

  // Create executors with mock context
  const executors = createAgentExecutors({
    agentConfig: createMockResolvedAgentConfig(),
    get: () => mockStore,
    messageKey: context.messageKey,
    operationId: context.operationId,
    parentId: context.parentId,
    skipCreateFirstMessage,
  });

  const executorFn = executors[executor];
  if (!executorFn) {
    throw new Error(`Executor ${executor} not found`);
  }

  // Execute
  const result = await executorFn(instruction, state);

  return result;
};

/**
 * Create initial agent runtime state for testing
 */
export const createInitialState = (overrides: Partial<AgentState> = {}): AgentState => {
  const defaultState: any = {
    lastModified: new Date().toISOString(),
    messages: [],
    sessionId: 'test-session',
    status: 'running',
    stepCount: 1,
    usage: {
      humanInteraction: {
        approvalRequests: 0,
        promptRequests: 0,
        selectRequests: 0,
        totalWaitingTimeMs: 0,
      },
      llm: {
        apiCalls: 0,
        processingTimeMs: 0,
        tokens: {
          input: 0,
          output: 0,
          total: 0,
        },
      },
      tools: {
        byTool: [],
        totalCalls: 0,
        totalTimeMs: 0,
      },
    },
  };

  return {
    ...defaultState,
    ...overrides,
  } as AgentState;
};

/**
 * Create a test context object for executor
 */
export const createTestContext = (
  overrides: {
    agentId?: string;
    groupId?: string;
    messageKey?: string;
    operationId?: string;
    parentId?: string;
    subAgentId?: string;
    topicId?: string | null;
  } = {},
) => {
  return {
    agentId: overrides.agentId || 'test-session',
    groupId: overrides.groupId,
    messageKey:
      overrides.messageKey ||
      `${overrides.agentId || 'test-session'}_${overrides.topicId !== undefined ? overrides.topicId : 'test-topic'}`,
    operationId: overrides.operationId || 'op_test',
    parentId: overrides.parentId || 'msg_parent',
    subAgentId: overrides.subAgentId,
    topicId: overrides.topicId !== undefined ? overrides.topicId : 'test-topic',
  };
};
