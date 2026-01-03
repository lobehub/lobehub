/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
import type { AgentState, ExecutorResult } from '@lobechat/agent-runtime';
import { GroupOrchestrationRuntime, GroupOrchestrationSupervisor } from '@lobechat/agent-runtime';
import { type TaskStatusResult } from '@lobechat/types';
import debug from 'debug';
import { type SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { useClientDataSWR } from '@/libs/swr';
import { aiAgentService } from '@/services/aiAgent';
import { createGroupOrchestrationExecutors } from '@/store/chat/agents/GroupOrchestration';
import { type ChatStore } from '@/store/chat/store';
import type { GroupOrchestrationCallbacks } from '@/store/tool/slices/builtin/types';

const log = debug('lobe-store:group-orchestration');

/**
 * Default maximum rounds for group orchestration
 */
const DEFAULT_MAX_ROUNDS = 10;

// SWR key for polling task status
const SWR_USE_POLLING_TASK_STATUS = 'SWR_USE_POLLING_TASK_STATUS';

// Polling interval for task status (5 seconds)
const POLLING_INTERVAL = 5000;

export interface GroupOrchestrationParams {
  groupId: string;
  /**
   * Initial result to start the orchestration
   * This is the first ExecutorResult that will be passed to Supervisor.decide()
   */
  initialResult: ExecutorResult;
  supervisorAgentId: string;
  topicId?: string;
}

export interface GroupOrchestrationAction {
  /**
   * Internal: Execute Group Orchestration Loop
   * Called by triggerSpeak/triggerBroadcast/triggerDelegate after supervisor decides next action
   */
  internal_execGroupOrchestration: (params: GroupOrchestrationParams) => Promise<AgentState>;

  /**
   * Get active group orchestration callbacks
   * Used by invokeBuiltinTool to inject callbacks into tool context
   */
  getGroupOrchestrationCallbacks: () => GroupOrchestrationCallbacks;

  /**
   * Trigger speak - called by speak tool when supervisor decides to let an agent speak
   * This starts the group orchestration loop with supervisor_decided result
   */
  triggerSpeak: GroupOrchestrationCallbacks['triggerSpeak'];

  /**
   * Trigger broadcast - called by broadcast tool when supervisor decides to broadcast
   * This starts the group orchestration loop with supervisor_decided result
   */
  triggerBroadcast: GroupOrchestrationCallbacks['triggerBroadcast'];

  /**
   * Trigger delegate - called by delegate tool when supervisor decides to delegate
   * This starts the group orchestration loop with supervisor_decided result
   */
  triggerDelegate: GroupOrchestrationCallbacks['triggerDelegate'];

  /**
   * Trigger execute task - called by executeTask tool when supervisor decides to execute an async task
   * This starts the group orchestration loop with supervisor_decided result
   */
  triggerExecuteTask: GroupOrchestrationCallbacks['triggerExecuteTask'];

  /**
   * Enable polling for task status
   * Used by ProcessingState component to poll for real-time task updates
   *
   * @param threadId - Thread ID to poll status for
   * @param messageId - Message ID to update with taskDetail
   * @param enabled - Whether polling should be enabled (caller decides based on processing state and active operations)
   */
  useEnablePollingTaskStatus: (
    threadId: string | undefined,
    messageId: string | undefined,
    enabled: boolean,
  ) => SWRResponse<TaskStatusResult>;
}

export const groupOrchestrationSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  GroupOrchestrationAction
> = (set, get) => ({
  /**
   * Trigger speak - Entry point when supervisor calls speak tool
   * Creates a supervisor_decided result with decision='speak' and starts orchestration
   */
  triggerSpeak: async (params) => {
    const { supervisorAgentId, agentId, instruction, skipCallSupervisor } = params;
    log(
      '[triggerSpeak] Starting orchestration with speak: supervisorAgentId=%s, agentId=%s, instruction=%s, skipCallSupervisor=%s',
      supervisorAgentId,
      agentId,
      instruction,
      skipCallSupervisor,
    );

    const groupId = get().activeGroupId;
    if (!groupId) {
      log('[triggerSpeak] No active group, skipping');
      return;
    }

    // Start orchestration loop with supervisor_decided result (decision=speak)
    await get().internal_execGroupOrchestration({
      groupId,
      supervisorAgentId,
      topicId: get().activeTopicId,
      initialResult: {
        type: 'supervisor_decided',
        payload: {
          decision: 'speak',
          params: { agentId, instruction },
          skipCallSupervisor,
        },
      },
    });
  },

  /**
   * Trigger broadcast - Entry point when supervisor calls broadcast tool
   * Creates a supervisor_decided result with decision='broadcast' and starts orchestration
   */
  triggerBroadcast: async (params) => {
    const { supervisorAgentId, agentIds, instruction, skipCallSupervisor, toolMessageId } = params;
    log(
      '[triggerBroadcast] Starting orchestration with broadcast: supervisorAgentId=%s, agentIds=%o, instruction=%s, skipCallSupervisor=%s, toolMessageId=%s',
      supervisorAgentId,
      agentIds,
      instruction,
      skipCallSupervisor,
      toolMessageId,
    );

    const groupId = get().activeGroupId;
    if (!groupId) {
      log('[triggerBroadcast] No active group, skipping');
      return;
    }

    // Start orchestration loop with supervisor_decided result (decision=broadcast)
    await get().internal_execGroupOrchestration({
      groupId,
      supervisorAgentId,
      topicId: get().activeTopicId,
      initialResult: {
        type: 'supervisor_decided',
        payload: {
          decision: 'broadcast',
          params: { agentIds, instruction, toolMessageId },
          skipCallSupervisor,
        },
      },
    });
  },

  /**
   * Trigger delegate - Entry point when supervisor calls delegate tool
   * Creates a supervisor_decided result with decision='delegate' and starts orchestration
   */
  triggerDelegate: async (params) => {
    const { supervisorAgentId, agentId, reason } = params;
    log(
      '[triggerDelegate] Starting orchestration with delegate: supervisorAgentId=%s, agentId=%s, reason=%s',
      supervisorAgentId,
      agentId,
      reason,
    );

    const groupId = get().activeGroupId;
    if (!groupId) {
      log('[triggerDelegate] No active group, skipping');
      return;
    }

    // Start orchestration loop with supervisor_decided result (decision=delegate)
    await get().internal_execGroupOrchestration({
      groupId,
      supervisorAgentId,
      topicId: get().activeTopicId,
      initialResult: {
        type: 'supervisor_decided',
        payload: {
          decision: 'delegate',
          params: { agentId, reason },
          skipCallSupervisor: false, // delegate always ends orchestration
        },
      },
    });
  },

  /**
   * Trigger execute task - Entry point when supervisor calls executeTask tool
   * Creates a supervisor_decided result with decision='execute_task' and starts orchestration
   */
  triggerExecuteTask: async (params) => {
    const { supervisorAgentId, agentId, task, timeout, toolMessageId, skipCallSupervisor } = params;
    log(
      '[triggerExecuteTask] Starting orchestration with execute_task: supervisorAgentId=%s, agentId=%s, task=%s, timeout=%s, toolMessageId=%s, skipCallSupervisor=%s',
      supervisorAgentId,
      agentId,
      task,
      timeout,
      toolMessageId,
      skipCallSupervisor,
    );

    const groupId = get().activeGroupId;
    if (!groupId) {
      log('[triggerExecuteTask] No active group, skipping');
      return;
    }

    // Start orchestration loop with supervisor_decided result (decision=execute_task)
    await get().internal_execGroupOrchestration({
      groupId,
      supervisorAgentId,
      topicId: get().activeTopicId,
      initialResult: {
        type: 'supervisor_decided',
        payload: {
          decision: 'execute_task',
          params: { agentId, task, timeout, toolMessageId },
          skipCallSupervisor: skipCallSupervisor ?? false,
        },
      },
    });
  },

  /**
   * Get group orchestration callbacks
   * These are the action methods that tools can call to trigger orchestration
   */
  getGroupOrchestrationCallbacks: () => {
    return {
      triggerSpeak: get().triggerSpeak,
      triggerBroadcast: get().triggerBroadcast,
      triggerDelegate: get().triggerDelegate,
      triggerExecuteTask: get().triggerExecuteTask,
    };
  },

  /**
   * Internal: Execute the Group Orchestration Loop
   * Called after supervisor decides to speak/broadcast/delegate/execute_task
   */
  internal_execGroupOrchestration: async (params) => {
    const { groupId, topicId, initialResult, supervisorAgentId } = params;

    log(
      '[internal_execGroupOrchestration] Starting orchestration for group: %s, supervisorAgentId: %s, initialResult: %s',
      groupId,
      supervisorAgentId,
      initialResult.type,
    );

    // 1. Create Orchestration Operation
    const { operationId } = get().startOperation({
      type: 'execAgentRuntime',
      context: { groupId, topicId, agentId: supervisorAgentId, scope: 'group' },
      label: `Group Orchestration (${initialResult.type})`,
    });

    log('[internal_execGroupOrchestration] Created operation: %s', operationId);

    // 2. Get Group Configuration
    const groupConfig = {
      supervisorAgentId,
      maxRounds: DEFAULT_MAX_ROUNDS,
    };

    log('[internal_execGroupOrchestration] Group config: %o', groupConfig);

    // 3. Create Orchestration Supervisor (State Machine)
    const orchestrationSupervisor = new GroupOrchestrationSupervisor({
      supervisorAgentId: groupConfig.supervisorAgentId,
      maxRounds: groupConfig.maxRounds,
    });

    // 4. Create Executors (Execution Layer)
    const executors = createGroupOrchestrationExecutors({
      get,
      messageContext: { agentId: supervisorAgentId, groupId, scope: 'group', topicId },
      orchestrationOperationId: operationId,
      supervisorAgentId: groupConfig.supervisorAgentId,
    });

    // 5. Create GroupOrchestrationRuntime
    const runtime = new GroupOrchestrationRuntime(orchestrationSupervisor, {
      executors,
      operationId,
      getOperation: (opId: string) => {
        const op = get().operations[opId];
        if (!op) throw new Error(`Operation not found: ${opId}`);
        return {
          abortController: op.abortController,
          context: op.context as Record<string, unknown>,
        };
      },
    });

    // 6. Initialize State
    let state = GroupOrchestrationRuntime.createInitialState({
      operationId,
    });

    log(
      '[internal_execGroupOrchestration] Starting orchestration loop with initial result: %s',
      initialResult.type,
    );

    // 7. Orchestration Loop
    // Start with the initial result (supervisor_decided) and loop until no more results
    let currentResult: ExecutorResult | undefined = initialResult;
    let stepCount = 0;

    while (currentResult && state.status !== 'done' && state.status !== 'error') {
      // Check if operation has been cancelled
      const currentOperation = get().operations[operationId];
      if (currentOperation?.status === 'cancelled') {
        log('[internal_execGroupOrchestration] Operation cancelled, stopping loop');
        state = { ...state, status: 'done' };
        break;
      }

      stepCount++;
      log(
        '[internal_execGroupOrchestration][step-%d]: result=%s, status=%s',
        stepCount,
        currentResult.type,
        state.status,
      );

      const output = await runtime.step(state, currentResult);

      log(
        '[internal_execGroupOrchestration] Step %d completed, events: %d, newStatus=%s, nextResult=%s',
        stepCount,
        output.events.length,
        output.newState.status,
        output.result?.type || 'none',
      );

      state = output.newState;
      currentResult = output.result;
    }

    log(
      '[internal_execGroupOrchestration] Orchestration loop finished, final status: %s, total steps: %d',
      state.status,
      stepCount,
    );

    // 8. Complete Operation
    if (state.status === 'done') {
      get().completeOperation(operationId);
      log('[internal_execGroupOrchestration] Operation completed successfully');
    } else if (state.status === 'error') {
      get().failOperation(operationId, {
        type: 'orchestration_error',
        message: 'Group orchestration execution failed',
      });
      log('[internal_execGroupOrchestration] Operation failed');
    }

    return state;
  },

  /**
   * Enable polling for task status using SWR
   * Caller is responsible for determining when to enable polling
   */
  useEnablePollingTaskStatus: (threadId, messageId, enabled) => {
    return useClientDataSWR<TaskStatusResult>(
      enabled && threadId && messageId ? [SWR_USE_POLLING_TASK_STATUS, threadId] : null,
      async ([, tid]: [string, string]) => {
        return aiAgentService.getSubAgentTaskStatus({ threadId: tid });
      },
      {
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
        refreshInterval: POLLING_INTERVAL,
        onSuccess: (data) => {
          if (data?.taskDetail && messageId) {
            // Update taskDetail
            get().internal_dispatchMessage({
              id: messageId,
              type: 'updateMessage',
              value: { taskDetail: data.taskDetail },
            });

            // Update content when task is completed or failed
            if (
              (data.status === 'completed' || data.status === 'failed') &&
              data.result !== undefined
            ) {
              get().internal_dispatchMessage({
                id: messageId,
                type: 'updateMessage',
                value: { content: data.result },
              });
            }
          }
        },
      },
    );
  },
});
