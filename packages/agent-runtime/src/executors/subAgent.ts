import pMap from 'p-map';

import type { AgentRuntimeHost, SubAgentExecutionStatus } from '../transport';
import type {
  AgentEvent,
  AgentInstructionExecSubAgent,
  AgentInstructionExecSubAgents,
  AgentRuntimeContext,
  AgentState,
  InstructionExecutor,
  SubAgentResultPayload,
  SubAgentsBatchResultPayload,
  SubAgentTask,
} from '../types';

type TaskExecutionResult = SubAgentResultPayload['result'] & {
  status?: SubAgentExecutionStatus;
};

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

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
};

const executeTask = async (
  host: AgentRuntimeHost,
  state: AgentState,
  parentMessageId: string,
  task: SubAgentTask,
): Promise<TaskExecutionResult> => {
  const agentId = host.operation.agentId ?? state.metadata?.agentId;
  const targetAgentId = task.targetAgentId ?? agentId;
  const topicId = host.operation.topicId ?? state.metadata?.topicId;

  if (!agentId || !targetAgentId || !topicId) {
    return {
      error: 'No valid context available',
      success: false,
      threadId: '',
    };
  }

  if (!host.transports.subAgent) {
    return {
      error: 'Sub-agent dispatch is not available.',
      success: false,
      threadId: '',
    };
  }

  try {
    const execution = await host.transports.subAgent.execSubAgent({
      agentId: targetAgentId,
      groupId: host.operation.groupId ?? state.metadata?.groupId ?? undefined,
      instruction: task.instruction,
      parentMessageId,
      parentOperationId: host.operation.operationId,
      timeout: task.timeout,
      title: task.description,
      topicId,
    });

    return {
      ...(execution.error && { error: execution.error }),
      ...(execution.result !== undefined && { result: execution.result }),
      ...(execution.status && { status: execution.status }),
      success: execution.success,
      threadId: execution.threadId ?? '',
    };
  } catch (error) {
    return {
      error: getErrorMessage(error),
      success: false,
      threadId: '',
    };
  }
};

const toPayloadResult = (execution: TaskExecutionResult): SubAgentResultPayload['result'] => {
  const { status: _status, ...result } = execution;
  return result;
};

const formatSingleResultContent = (result: TaskExecutionResult): string | undefined => {
  if (!result.status) return undefined;
  if (result.success) return result.result ?? 'Completed successfully.';

  if (result.status === 'cancelled') {
    return result.error === 'Operation cancelled'
      ? 'Task was cancelled by user.'
      : 'Task was cancelled';
  }

  if (result.status === 'timed_out') return result.error ?? 'Task timed out';

  const error = result.error ?? 'Unknown error';
  return result.threadId ? `Task failed: ${error}` : `Task creation failed: ${error}`;
};

const formatBatchResultContent = (
  tasks: SubAgentTask[],
  results: SubAgentsBatchResultPayload['results'],
) =>
  results
    .map((result, index) => {
      const title = tasks[index]?.description ?? `Task ${index + 1}`;
      const content = result.success
        ? (result.result ?? 'Completed successfully.')
        : `Failed: ${result.error ?? 'Unknown error'}`;

      return `${index + 1}. ${title}\n${content}`;
    })
    .join('\n\n');

const queryMessages = (host: AgentRuntimeHost, state: AgentState) =>
  host.transports.messages.query({
    agentId: host.operation.agentId ?? state.metadata?.agentId,
    groupId: host.operation.groupId ?? state.metadata?.groupId ?? undefined,
    threadId: host.operation.threadId ?? state.metadata?.threadId,
    topicId: host.operation.topicId ?? state.metadata?.topicId,
  });

export const execSubAgent =
  (host: AgentRuntimeHost): InstructionExecutor =>
  async (instruction, state) => {
    const { payload } = instruction as AgentInstructionExecSubAgent;
    const { parentMessageId, task } = payload;
    const events: AgentEvent[] = [];
    const { operationId } = host.operation;

    if (state.metadata?.isSubAgent === true) {
      return {
        events,
        newState: state,
        nextContext: createNestedSingleResult(state, operationId, parentMessageId),
      };
    }

    const execution = await executeTask(host, state, parentMessageId, task);
    let newState = state;

    if (execution.status) {
      const content = formatSingleResultContent(execution);
      if (content !== undefined) {
        await host.transports.messages.update(parentMessageId, { content });
      }
      newState = { ...state, messages: await queryMessages(host, state) };
    }

    return {
      events,
      newState,
      nextContext: {
        payload: {
          parentMessageId,
          result: toPayloadResult(execution),
        },
        phase: 'sub_agent_result',
        session: createSessionContext(newState, operationId),
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

    if (state.metadata?.isSubAgent === true) {
      return {
        events,
        newState: state,
        nextContext: createNestedBatchResult(state, operationId, parentMessageId, tasks),
      };
    }

    const executions = await pMap(
      tasks,
      (task) => executeTask(host, state, parentMessageId, task),
      { concurrency: 15 },
    );
    const results = executions.map(toPayloadResult);
    const hasTerminalResults = executions.length > 0 && executions.every((result) => result.status);
    let newState = state;

    if (hasTerminalResults) {
      await host.transports.messages.update(parentMessageId, {
        content: formatBatchResultContent(tasks, results),
      });
      newState = { ...state, messages: await queryMessages(host, state) };
    }

    return {
      events,
      newState,
      nextContext: {
        payload: {
          parentMessageId,
          results,
        },
        phase: 'sub_agents_batch_result',
        session: createSessionContext(newState, operationId),
      } as AgentRuntimeContext,
    };
  };
