import type { AgentRuntimeHost } from '../transport';
import type {
  AgentEvent,
  AgentInstructionExecSubAgent,
  AgentInstructionExecSubAgents,
  AgentRuntimeContext,
  AgentState,
  InstructionExecutor,
  SubAgentTask,
} from '../types';

interface SubAgentTaskWithTarget extends SubAgentTask {
  targetAgentId?: string;
}

const createSessionContext = (state: AgentState, operationId: string) => ({
  messageCount: state.messages.length,
  sessionId: operationId,
  status: 'running' as const,
  stepCount: state.stepCount + 1,
});

const createNestedSingleResult = (
  state: AgentState,
  operationId: string,
  parentMessageId: string,
): AgentRuntimeContext =>
  ({
    payload: {
      parentMessageId,
      result: {
        error: 'Sub-agent calls cannot be triggered from within another sub-agent.',
        success: false,
        threadId: '',
      },
    },
    phase: 'sub_agent_result',
    session: createSessionContext(state, operationId),
  }) as AgentRuntimeContext;

const createNestedBatchResult = (
  state: AgentState,
  operationId: string,
  parentMessageId: string,
  tasks: SubAgentTask[],
): AgentRuntimeContext =>
  ({
    payload: {
      parentMessageId,
      results: tasks.map((task) => ({
        description: task.description,
        error: 'Sub-agent calls cannot be triggered from within another sub-agent.',
        success: false,
        threadId: '',
      })),
    },
    phase: 'sub_agents_batch_result',
    session: createSessionContext(state, operationId),
  }) as AgentRuntimeContext;

const resolveTaskAgentId = (task: SubAgentTask, fallbackAgentId?: string) =>
  (task as SubAgentTaskWithTarget).targetAgentId ?? fallbackAgentId;

export const execSubAgent =
  (host: AgentRuntimeHost): InstructionExecutor =>
  async (instruction, state) => {
    const { payload } = instruction as AgentInstructionExecSubAgent;
    const { parentMessageId, task } = payload;
    const events: AgentEvent[] = [];
    const { operationId } = host.operation;

    const topicId = host.operation.topicId ?? state.metadata?.topicId;
    const agentId = state.metadata?.agentId;
    const targetAgentId = resolveTaskAgentId(task, agentId);

    if (state.metadata?.isSubAgent === true) {
      return {
        events,
        newState: state,
        nextContext: createNestedSingleResult(state, operationId, parentMessageId),
      };
    }

    let dispatched = false;
    let threadId = '';

    if (host.transports.subAgent && topicId && agentId && targetAgentId) {
      try {
        const dispatchResult = await host.transports.subAgent.execSubAgent({
          agentId: targetAgentId,
          groupId: state.metadata?.groupId ?? undefined,
          instruction: task.instruction,
          parentMessageId,
          parentOperationId: operationId,
          timeout: task.timeout,
          title: task.description,
          topicId,
        });
        dispatched = dispatchResult.success;
        threadId = dispatchResult.threadId ?? '';
      } catch {
        // Dispatch failures are reported in the sub_agent_result payload.
      }
    }

    return {
      events,
      newState: state,
      nextContext: {
        payload: {
          parentMessageId,
          result: {
            success: dispatched,
            threadId,
          },
        },
        phase: 'sub_agent_result',
        session: createSessionContext(state, operationId),
      } as AgentRuntimeContext,
    };
  };

export const execSubAgents =
  (host: AgentRuntimeHost): InstructionExecutor =>
  async (instruction, state) => {
    const { payload } = instruction as AgentInstructionExecSubAgents;
    const { parentMessageId, tasks } = payload;
    const events: AgentEvent[] = [];
    const { operationId } = host.operation;

    const topicId = host.operation.topicId ?? state.metadata?.topicId;
    const agentId = state.metadata?.agentId;

    if (state.metadata?.isSubAgent === true) {
      return {
        events,
        newState: state,
        nextContext: createNestedBatchResult(state, operationId, parentMessageId, tasks),
      };
    }

    const taskResults: Array<{ success: boolean; threadId: string }> = [];

    for (const task of tasks) {
      const targetAgentId = resolveTaskAgentId(task, agentId);

      let taskDispatched = false;
      let threadId = '';

      if (host.transports.subAgent && topicId && agentId && targetAgentId) {
        try {
          const dispatchResult = await host.transports.subAgent.execSubAgent({
            agentId: targetAgentId,
            groupId: state.metadata?.groupId ?? undefined,
            instruction: task.instruction,
            parentMessageId,
            parentOperationId: operationId,
            timeout: task.timeout,
            title: task.description,
            topicId,
          });
          taskDispatched = dispatchResult.success;
          threadId = dispatchResult.threadId ?? '';
        } catch {
          // Dispatch failures are reported in the batch result payload.
        }
      }

      taskResults.push({
        success: taskDispatched,
        threadId,
      });
    }

    return {
      events,
      newState: state,
      nextContext: {
        payload: {
          parentMessageId,
          results: taskResults,
        },
        phase: 'sub_agents_batch_result',
        session: createSessionContext(state, operationId),
      } as AgentRuntimeContext,
    };
  };
