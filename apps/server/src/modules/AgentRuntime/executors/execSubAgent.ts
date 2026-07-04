import {
  type AgentEvent,
  type AgentInstructionExecSubAgent,
  type AgentInstructionExecSubAgents,
  type AgentRuntimeContext,
  type InstructionExecutor,
} from '@lobechat/agent-runtime';

import { type RuntimeExecutorContext } from '../context';
import { log } from '../executorHelpers';

export const execSubAgent =
  (ctx: RuntimeExecutorContext): InstructionExecutor =>
  async (instruction, state) => {
    const { payload } = instruction as AgentInstructionExecSubAgent;
    const { parentMessageId, task } = payload;
    const events: AgentEvent[] = [];
    const { operationId } = ctx;
    const taskLogId = `${operationId}:exec_sub_agent`;

    const topicId = ctx.topicId ?? state.metadata?.topicId;
    const agentId = state.metadata?.agentId;
    // targetAgentId is a cloud extension injected by agentManagement.callAgent
    const targetAgentId = (task as any).targetAgentId ?? agentId;

    if (state.metadata?.isSubAgent === true) {
      log('[%s] Nested sub-agent dispatch blocked', taskLogId);
      return {
        events,
        newState: state,
        nextContext: {
          payload: {
            parentMessageId,
            result: {
              error: 'Sub-agent calls cannot be triggered from within another sub-agent.',
              success: false,
              taskMessageId: parentMessageId,
              threadId: '',
            },
          },
          phase: 'sub_agent_result',
          session: {
            messageCount: state.messages.length,
            sessionId: operationId,
            status: 'running',
            stepCount: state.stepCount + 1,
          },
        } as unknown as AgentRuntimeContext,
      };
    }

    let taskMessageId: string | undefined;
    try {
      const taskMessage = await ctx.messageModel.create({
        agentId: agentId!,
        content: '',
        groupId: state.metadata?.groupId ?? undefined,
        metadata: {
          instruction: task.instruction,
          taskTitle: task.description,
          ...(targetAgentId && targetAgentId !== agentId && { targetAgentId }),
        },
        parentId: parentMessageId,
        role: 'task',
        threadId: state.metadata?.threadId ?? undefined,
        topicId: topicId!,
      });
      taskMessageId = taskMessage.id;
      log('[%s] Created task message: %s', taskLogId, taskMessageId);
    } catch (error) {
      log('[%s] Failed to create task message: %O', taskLogId, error);
    }

    const effectiveTaskMessageId = taskMessageId ?? parentMessageId;

    let dispatched = false;
    if (ctx.execSubAgent && topicId && agentId) {
      try {
        await ctx.execSubAgent({
          agentId: targetAgentId,
          groupId: state.metadata?.groupId ?? undefined,
          instruction: task.instruction,
          parentMessageId: effectiveTaskMessageId,
          parentOperationId: operationId,
          timeout: task.timeout,
          title: task.description,
          topicId,
        });
        dispatched = true;
        log('[%s] Spawned sub-agent task for agent %s', taskLogId, targetAgentId);
      } catch (error) {
        log('[%s] Failed to spawn sub-agent task: %O', taskLogId, error);
        if (taskMessageId) {
          try {
            await ctx.messageModel.update(taskMessageId, {
              content: `Task failed to start: ${(error as Error).message}`,
            });
          } catch {
            // best-effort
          }
        }
      }
    } else {
      log('[%s] execSubAgent not available, skipping sub-agent dispatch', taskLogId);
    }

    return {
      events,
      newState: state,
      nextContext: {
        payload: {
          parentMessageId: effectiveTaskMessageId,
          result: {
            success: dispatched,
            taskMessageId: effectiveTaskMessageId,
            threadId: '',
          },
        },
        phase: 'sub_agent_result',
        session: {
          messageCount: state.messages.length,
          sessionId: operationId,
          status: 'running',
          stepCount: state.stepCount + 1,
        },
      } as unknown as AgentRuntimeContext,
    };
  };

export const execSubAgents =
  (ctx: RuntimeExecutorContext): InstructionExecutor =>
  async (instruction, state) => {
    const { payload } = instruction as AgentInstructionExecSubAgents;
    const { parentMessageId, tasks } = payload;
    const events: AgentEvent[] = [];
    const { operationId } = ctx;
    const taskLogId = `${operationId}:exec_sub_agents`;

    const topicId = ctx.topicId ?? state.metadata?.topicId;
    const agentId = state.metadata?.agentId;

    log('[%s] Starting batch of %d tasks', taskLogId, tasks.length);

    if (state.metadata?.isSubAgent === true) {
      log('[%s] Nested sub-agent batch dispatch blocked', taskLogId);
      return {
        events,
        newState: state,
        nextContext: {
          payload: {
            parentMessageId,
            results: tasks.map((task) => ({
              description: task.description,
              error: 'Sub-agent calls cannot be triggered from within another sub-agent.',
              success: false,
              taskMessageId: parentMessageId,
              threadId: '',
            })),
          },
          phase: 'sub_agents_batch_result',
          session: {
            messageCount: state.messages.length,
            sessionId: operationId,
            status: 'running',
            stepCount: state.stepCount + 1,
          },
        } as unknown as AgentRuntimeContext,
      };
    }

    let lastTaskMessageId: string | undefined;
    const taskResults: Array<{ success: boolean; taskMessageId: string; threadId: string }> = [];

    for (const task of tasks) {
      const targetAgentId = (task as any).targetAgentId ?? agentId;
      let taskMessageId: string | undefined;

      try {
        const taskMessage = await ctx.messageModel.create({
          agentId: agentId!,
          content: '',
          groupId: state.metadata?.groupId ?? undefined,
          metadata: {
            instruction: task.instruction,
            taskTitle: task.description,
            ...(targetAgentId && targetAgentId !== agentId && { targetAgentId }),
          },
          parentId: parentMessageId,
          role: 'task',
          threadId: state.metadata?.threadId ?? undefined,
          topicId: topicId!,
        });
        taskMessageId = taskMessage.id;
        lastTaskMessageId = taskMessageId;
      } catch (error) {
        log('[%s] Failed to create task message for "%s": %O', taskLogId, task.description, error);
      }

      let taskDispatched = false;
      if (ctx.execSubAgent && topicId && agentId) {
        try {
          await ctx.execSubAgent({
            agentId: targetAgentId,
            groupId: state.metadata?.groupId ?? undefined,
            instruction: task.instruction,
            parentMessageId: taskMessageId ?? parentMessageId,
            parentOperationId: operationId,
            timeout: task.timeout,
            title: task.description,
            topicId,
          });
          taskDispatched = true;
          log(
            '[%s] Spawned sub-agent task "%s" for agent %s',
            taskLogId,
            task.description,
            targetAgentId,
          );
        } catch (error) {
          log('[%s] Failed to spawn task "%s": %O', taskLogId, task.description, error);
          if (taskMessageId) {
            try {
              await ctx.messageModel.update(taskMessageId, {
                content: `Task failed to start: ${(error as Error).message}`,
              });
            } catch {
              // best-effort
            }
          }
        }
      }
      taskResults.push({
        success: taskDispatched,
        taskMessageId: taskMessageId ?? parentMessageId,
        threadId: '',
      });
    }

    return {
      events,
      newState: state,
      nextContext: {
        payload: {
          parentMessageId: lastTaskMessageId ?? parentMessageId,
          results: taskResults,
        },
        phase: 'sub_agents_batch_result',
        session: {
          messageCount: state.messages.length,
          sessionId: operationId,
          status: 'running',
          stepCount: state.stepCount + 1,
        },
      } as unknown as AgentRuntimeContext,
    };
  };
