import { type AgentState } from '@lobechat/agent-runtime';
import { type UIChatMessage } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import { describe, expect, it, vi } from 'vitest';

import { type ChatStore } from '@/store/chat/store';

import { createGroupOrchestrationExecutors } from '../createGroupOrchestrationExecutors';

const TEST_IDS = {
  GROUP_ID: 'test-group-id',
  OPERATION_ID: 'test-operation-id',
  ORCHESTRATION_OPERATION_ID: 'test-orchestration-operation-id',
  SUPERVISOR_AGENT_ID: 'test-supervisor-agent-id',
  TOPIC_ID: 'test-topic-id',
  USER_MESSAGE_ID: 'test-user-message-id',
};

/**
 * Create a minimal mock store for group orchestration executor tests
 */
const createMockStore = (overrides: Partial<ChatStore> = {}): ChatStore => {
  const operations: Record<string, any> = {};

  return {
    dbMessagesMap: {},
    internal_execAgentRuntime: vi.fn().mockResolvedValue(undefined),
    messagesMap: {},
    operations,
    startOperation: vi.fn().mockImplementation((config) => {
      const operationId = `op_${nanoid()}`;
      const abortController = new AbortController();
      operations[operationId] = {
        abortController,
        context: config.context || {},
        id: operationId,
        status: 'running',
        type: config.type,
      };
      return { abortController, operationId };
    }),
    ...overrides,
  } as unknown as ChatStore;
};

/**
 * Create initial agent state for testing
 */
const createInitialState = (overrides: Partial<AgentState> = {}): AgentState => {
  return {
    cost: {
      calculatedAt: new Date().toISOString(),
      currency: 'USD',
      llm: { byModel: [], currency: 'USD', total: 0 },
      tools: { byTool: [], currency: 'USD', total: 0 },
      total: 0,
    },
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
    maxSteps: 10,
    messages: [],
    operationId: TEST_IDS.OPERATION_ID,
    status: 'running',
    stepCount: 0,
    toolManifestMap: {},
    usage: {
      humanInteraction: {
        approvalRequests: 0,
        promptRequests: 0,
        selectRequests: 0,
        totalWaitingTimeMs: 0,
      },
      llm: { apiCalls: 0, processingTimeMs: 0, tokens: { input: 0, output: 0, total: 0 } },
      tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
    },
    userInterventionConfig: { allowList: [], approvalMode: 'auto' },
    ...overrides,
  } as AgentState;
};

describe('createGroupOrchestrationExecutors', () => {
  describe('call_supervisor executor', () => {
    it('should NOT pass operationId to internal_execAgentRuntime (creates new child operation)', async () => {
      const mockStore = createMockStore({
        dbMessagesMap: {
          [`group_${TEST_IDS.GROUP_ID}_${TEST_IDS.TOPIC_ID}`]: [
            {
              content: 'Hello',
              createdAt: Date.now(),
              id: TEST_IDS.USER_MESSAGE_ID,
              role: 'user',
              updatedAt: Date.now(),
            } as UIChatMessage,
          ],
        },
      });

      const executors = createGroupOrchestrationExecutors({
        get: () => mockStore,
        messageContext: {
          agentId: TEST_IDS.GROUP_ID,
          scope: 'group',
          topicId: TEST_IDS.TOPIC_ID,
        },
        orchestrationOperationId: TEST_IDS.ORCHESTRATION_OPERATION_ID,
        supervisorAgentId: TEST_IDS.SUPERVISOR_AGENT_ID,
      });

      const callSupervisorExecutor = executors.call_supervisor!;

      await callSupervisorExecutor(
        {
          payload: { round: 1, supervisorAgentId: TEST_IDS.SUPERVISOR_AGENT_ID },
          type: 'call_supervisor',
        },
        createInitialState(),
      );

      // Verify internal_execAgentRuntime was called
      expect(mockStore.internal_execAgentRuntime).toHaveBeenCalledTimes(1);

      // Verify operationId is NOT passed (should be undefined)
      // This ensures a new child operation is created
      const callArgs = (mockStore.internal_execAgentRuntime as any).mock.calls[0][0];
      expect(callArgs.operationId).toBeUndefined();

      // Verify parentOperationId is passed correctly
      expect(callArgs.parentOperationId).toBe(TEST_IDS.ORCHESTRATION_OPERATION_ID);

      // Verify isSupervisor is passed in context
      expect(callArgs.context.isSupervisor).toBe(true);

      // Verify agentId is the supervisor agent id
      expect(callArgs.context.agentId).toBe(TEST_IDS.SUPERVISOR_AGENT_ID);
    });

    it('should pass isSupervisor: true in context for supervisor messages metadata', async () => {
      const mockStore = createMockStore({
        dbMessagesMap: {
          [`group_${TEST_IDS.GROUP_ID}_${TEST_IDS.TOPIC_ID}`]: [
            {
              content: 'Hello',
              createdAt: Date.now(),
              id: TEST_IDS.USER_MESSAGE_ID,
              role: 'user',
              updatedAt: Date.now(),
            } as UIChatMessage,
          ],
        },
      });

      const executors = createGroupOrchestrationExecutors({
        get: () => mockStore,
        messageContext: {
          agentId: TEST_IDS.GROUP_ID,
          scope: 'group',
          topicId: TEST_IDS.TOPIC_ID,
        },
        orchestrationOperationId: TEST_IDS.ORCHESTRATION_OPERATION_ID,
        supervisorAgentId: TEST_IDS.SUPERVISOR_AGENT_ID,
      });

      const callSupervisorExecutor = executors.call_supervisor!;

      await callSupervisorExecutor(
        {
          payload: { round: 1, supervisorAgentId: TEST_IDS.SUPERVISOR_AGENT_ID },
          type: 'call_supervisor',
        },
        createInitialState(),
      );

      const callArgs = (mockStore.internal_execAgentRuntime as any).mock.calls[0][0];

      // The key assertion: isSupervisor must be true
      // This is used by createAgentExecutors to set metadata.isSupervisor on assistant messages
      expect(callArgs.context).toMatchObject({
        agentId: TEST_IDS.SUPERVISOR_AGENT_ID,
        isSupervisor: true,
        scope: 'group',
        topicId: TEST_IDS.TOPIC_ID,
      });
    });
  });

  describe('call_agent executor', () => {
    it('should NOT pass operationId to internal_execAgentRuntime (creates new child operation)', async () => {
      const mockStore = createMockStore({
        dbMessagesMap: {
          [`group_${TEST_IDS.GROUP_ID}_${TEST_IDS.TOPIC_ID}`]: [
            {
              content: 'Hello',
              createdAt: Date.now(),
              id: TEST_IDS.USER_MESSAGE_ID,
              role: 'user',
              updatedAt: Date.now(),
            } as UIChatMessage,
          ],
        },
      });

      const executors = createGroupOrchestrationExecutors({
        get: () => mockStore,
        messageContext: {
          agentId: TEST_IDS.GROUP_ID,
          scope: 'group',
          topicId: TEST_IDS.TOPIC_ID,
        },
        orchestrationOperationId: TEST_IDS.ORCHESTRATION_OPERATION_ID,
        supervisorAgentId: TEST_IDS.SUPERVISOR_AGENT_ID,
      });

      const callAgentExecutor = executors.call_agent!;
      const targetAgentId = 'target-agent-id';

      await callAgentExecutor(
        {
          payload: { agentId: targetAgentId, instruction: 'Please respond' },
          type: 'call_agent',
        },
        createInitialState(),
      );

      // Verify internal_execAgentRuntime was called
      expect(mockStore.internal_execAgentRuntime).toHaveBeenCalledTimes(1);

      // Verify operationId is NOT passed (should be undefined)
      const callArgs = (mockStore.internal_execAgentRuntime as any).mock.calls[0][0];
      expect(callArgs.operationId).toBeUndefined();

      // Verify parentOperationId is passed correctly
      expect(callArgs.parentOperationId).toBe(TEST_IDS.ORCHESTRATION_OPERATION_ID);

      // Verify subAgentId is passed (NOT isSupervisor)
      expect(callArgs.context.subAgentId).toBe(targetAgentId);
      expect(callArgs.context.isSupervisor).toBeUndefined();
    });
  });

  describe('operation structure comparison', () => {
    it('call_supervisor and call_agent should both create independent child operations', async () => {
      const mockStore = createMockStore({
        dbMessagesMap: {
          [`group_${TEST_IDS.GROUP_ID}_${TEST_IDS.TOPIC_ID}`]: [
            {
              content: 'Hello',
              createdAt: Date.now(),
              id: TEST_IDS.USER_MESSAGE_ID,
              role: 'user',
              updatedAt: Date.now(),
            } as UIChatMessage,
          ],
        },
      });

      const executors = createGroupOrchestrationExecutors({
        get: () => mockStore,
        messageContext: {
          agentId: TEST_IDS.GROUP_ID,
          scope: 'group',
          topicId: TEST_IDS.TOPIC_ID,
        },
        orchestrationOperationId: TEST_IDS.ORCHESTRATION_OPERATION_ID,
        supervisorAgentId: TEST_IDS.SUPERVISOR_AGENT_ID,
      });

      // Execute call_supervisor
      await executors.call_supervisor!(
        {
          payload: { round: 1, supervisorAgentId: TEST_IDS.SUPERVISOR_AGENT_ID },
          type: 'call_supervisor',
        },
        createInitialState(),
      );

      // Execute call_agent
      await executors.call_agent!(
        {
          payload: { agentId: 'agent-1', instruction: 'test' },
          type: 'call_agent',
        },
        createInitialState(),
      );

      // Verify both were called
      expect(mockStore.internal_execAgentRuntime).toHaveBeenCalledTimes(2);

      // Get both call arguments
      const supervisorCallArgs = (mockStore.internal_execAgentRuntime as any).mock.calls[0][0];
      const agentCallArgs = (mockStore.internal_execAgentRuntime as any).mock.calls[1][0];

      // Both should NOT have operationId (create new child operations)
      expect(supervisorCallArgs.operationId).toBeUndefined();
      expect(agentCallArgs.operationId).toBeUndefined();

      // Both should have same parentOperationId (orchestration operation)
      expect(supervisorCallArgs.parentOperationId).toBe(TEST_IDS.ORCHESTRATION_OPERATION_ID);
      expect(agentCallArgs.parentOperationId).toBe(TEST_IDS.ORCHESTRATION_OPERATION_ID);

      // Supervisor should have isSupervisor: true
      expect(supervisorCallArgs.context.isSupervisor).toBe(true);
      expect(agentCallArgs.context.isSupervisor).toBeUndefined();
    });
  });
});
