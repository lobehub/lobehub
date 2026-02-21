/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
import { type AgentState, type ExecutorResult } from '@lobechat/agent-runtime';
import { GroupOrchestrationRuntime, GroupOrchestrationSupervisor } from '@lobechat/agent-runtime';
import { type TaskStatusResult } from '@lobechat/types';
import debug from 'debug';
import { type SWRResponse } from 'swr';

import { useClientDataSWR } from '@/libs/swr';
import { aiAgentService } from '@/services/aiAgent';
import { createGroupOrchestrationExecutors } from '@/store/chat/agents/GroupOrchestration';
import { type ChatStore } from '@/store/chat/store';
import { type GroupOrchestrationCallbacks } from '@/store/tool/slices/builtin/types';
import { type StoreSetter } from '@/store/types';

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

type Setter = StoreSetter<ChatStore>;
export const groupOrchestrationSlice = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new GroupOrchestrationActionImpl(set, get, _api);

export class GroupOrchestrationActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  getGroupOrchestrationCallbacks = (): GroupOrchestrationCallbacks => {
    return {
      triggerSpeak: this.#get().triggerSpeak,
      triggerBroadcast: this.#get().triggerBroadcast,
      triggerDelegate: this.#get().triggerDelegate,
      triggerExecuteTask: this.#get().triggerExecuteTask,
      triggerExecuteTasks: this.#get().triggerExecuteTasks,
    };
  };

  triggerSpeak = async (
    params: Parameters<GroupOrchestrationCallbacks['triggerSpeak']>[0],
  ): Promise<void> => {
    const { supervisorAgentId, agentId, instruction, skipCallSupervisor } = params;
    log(
      '[triggerSpeak] Starting orchestration with speak: supervisorAgentId=%s, agentId=%s, instruction=%s, skipCallSupervisor=%s',
      supervisorAgentId,
      agentId,
      instruction,
      skipCallSupervisor,
    );

    const groupId = this.#get().activeGroupId;
    if (!groupId) {
      log('[triggerSpeak] No active group, skipping');
      return;
    }

    await this.#get().internal_execGroupOrchestration({
      groupId,
      supervisorAgentId,
      topicId: this.#get().activeTopicId,
      initialResult: {
        type: 'supervisor_decided',
        payload: {
          decision: 'speak',
          params: { agentId, instruction },
          skipCallSupervisor,
        },
      },
    });
  };

  triggerBroadcast = async (
    params: Parameters<GroupOrchestrationCallbacks['triggerBroadcast']>[0],
  ): Promise<void> => {
    const { supervisorAgentId, agentIds, instruction, skipCallSupervisor, toolMessageId } = params;
    log(
      '[triggerBroadcast] Starting orchestration with broadcast: supervisorAgentId=%s, agentIds=%o, instruction=%s, skipCallSupervisor=%s, toolMessageId=%s',
      supervisorAgentId,
      agentIds,
      instruction,
      skipCallSupervisor,
      toolMessageId,
    );

    const groupId = this.#get().activeGroupId;
    if (!groupId) {
      log('[triggerBroadcast] No active group, skipping');
      return;
    }

    await this.#get().internal_execGroupOrchestration({
      groupId,
      supervisorAgentId,
      topicId: this.#get().activeTopicId,
      initialResult: {
        type: 'supervisor_decided',
        payload: {
          decision: 'broadcast',
          params: { agentIds, instruction, toolMessageId },
          skipCallSupervisor,
        },
      },
    });
  };

  triggerDelegate = async (
    params: Parameters<GroupOrchestrationCallbacks['triggerDelegate']>[0],
  ): Promise<void> => {
    const { supervisorAgentId, agentId, reason } = params;
    log(
      '[triggerDelegate] Starting orchestration with delegate: supervisorAgentId=%s, agentId=%s, reason=%s',
      supervisorAgentId,
      agentId,
      reason,
    );

    const groupId = this.#get().activeGroupId;
    if (!groupId) {
      log('[triggerDelegate] No active group, skipping');
      return;
    }

    await this.#get().internal_execGroupOrchestration({
      groupId,
      supervisorAgentId,
      topicId: this.#get().activeTopicId,
      initialResult: {
        type: 'supervisor_decided',
        payload: {
          decision: 'delegate',
          params: { agentId, reason },
          skipCallSupervisor: false,
        },
      },
    });
  };

  triggerExecuteTask = async (
    params: Parameters<GroupOrchestrationCallbacks['triggerExecuteTask']>[0],
  ): Promise<void> => {
    const {
      supervisorAgentId,
      agentId,
      instruction,
      timeout,
      toolMessageId,
      skipCallSupervisor,
      runInClient,
    } = params;
    log(
      '[triggerExecuteTask] Starting orchestration with execute_task: supervisorAgentId=%s, agentId=%s, instruction=%s, timeout=%s, toolMessageId=%s, skipCallSupervisor=%s, runInClient=%s',
      supervisorAgentId,
      agentId,
      instruction,
      timeout,
      toolMessageId,
      skipCallSupervisor,
      runInClient,
    );

    const groupId = this.#get().activeGroupId;
    if (!groupId) {
      log('[triggerExecuteTask] No active group, skipping');
      return;
    }

    await this.#get().internal_execGroupOrchestration({
      groupId,
      supervisorAgentId,
      topicId: this.#get().activeTopicId,
      initialResult: {
        type: 'supervisor_decided',
        payload: {
          decision: 'execute_task',
          params: { agentId, instruction, runInClient, timeout, toolMessageId },
          skipCallSupervisor: skipCallSupervisor ?? false,
        },
      },
    });
  };

  triggerExecuteTasks = async (
    params: Parameters<GroupOrchestrationCallbacks['triggerExecuteTasks']>[0],
  ): Promise<void> => {
    const { supervisorAgentId, tasks, toolMessageId, skipCallSupervisor } = params;
    log(
      '[triggerExecuteTasks] Starting orchestration with execute_tasks: supervisorAgentId=%s, tasks=%d, toolMessageId=%s, skipCallSupervisor=%s',
      supervisorAgentId,
      tasks.length,
      toolMessageId,
      skipCallSupervisor,
    );

    const groupId = this.#get().activeGroupId;
    if (!groupId) {
      log('[triggerExecuteTasks] No active group, skipping');
      return;
    }

    await this.#get().internal_execGroupOrchestration({
      groupId,
      supervisorAgentId,
      topicId: this.#get().activeTopicId,
      initialResult: {
        type: 'supervisor_decided',
        payload: {
          decision: 'execute_tasks',
          params: { tasks, toolMessageId },
          skipCallSupervisor: skipCallSupervisor ?? false,
        },
      },
    });
  };

  internal_execGroupOrchestration = async (
    params: GroupOrchestrationParams,
  ): Promise<AgentState> => {
    const { groupId, topicId, initialResult, supervisorAgentId } = params;

    log(
      '[internal_execGroupOrchestration] Starting orchestration for group: %s, supervisorAgentId: %s, initialResult: %s',
      groupId,
      supervisorAgentId,
      initialResult.type,
    );

    // 1. Create Orchestration Operation
    const { operationId } = this.#get().startOperation({
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
      get: this.#get,
      messageContext: { agentId: supervisorAgentId, groupId, scope: 'group', topicId },
      orchestrationOperationId: operationId,
      supervisorAgentId: groupConfig.supervisorAgentId,
    });

    // 5. Create GroupOrchestrationRuntime
    const runtime = new GroupOrchestrationRuntime(orchestrationSupervisor, {
      executors,
      operationId,
      getOperation: (opId: string) => {
        const op = this.#get().operations[opId];
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
      const currentOperation = this.#get().operations[operationId];
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
      this.#get().completeOperation(operationId);
      log('[internal_execGroupOrchestration] Operation completed successfully');
    } else if (state.status === 'error') {
      this.#get().failOperation(operationId, {
        type: 'orchestration_error',
        message: 'Group orchestration execution failed',
      });
      log('[internal_execGroupOrchestration] Operation failed');
    }

    return state;
  };

  useEnablePollingTaskStatus = (
    threadId: string | undefined,
    messageId: string | undefined,
    enabled: boolean,
  ): SWRResponse<TaskStatusResult> => {
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
          if (data && messageId) {
            // Update taskDetail and tasks (intermediate messages)
            this.#get().internal_dispatchMessage({
              id: messageId,
              type: 'updateMessage',
              value: {
                taskDetail: data.taskDetail,
                tasks: data.messages,
              },
            });

            // Update content when task is completed or failed
            if (
              (data.status === 'completed' || data.status === 'failed') &&
              data.result !== undefined
            ) {
              this.#get().internal_dispatchMessage({
                id: messageId,
                type: 'updateMessage',
                value: { content: data.result },
              });
            }
          }
        },
      },
    );
  };
}

export type GroupOrchestrationAction = Pick<
  GroupOrchestrationActionImpl,
  keyof GroupOrchestrationActionImpl
>;
