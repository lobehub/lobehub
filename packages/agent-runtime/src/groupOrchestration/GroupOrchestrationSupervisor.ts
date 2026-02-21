import type { AgentState } from '../types/state';
import type {
  ExecutorResult,
  IGroupOrchestrationSupervisor,
  SupervisorInstruction,
  SupervisorInstructionBatchExecAsyncTasks,
  SupervisorInstructionCallAgent,
  SupervisorInstructionCallSupervisor,
  SupervisorInstructionDelegate,
  SupervisorInstructionExecAsyncTask,
  SupervisorInstructionExecClientAsyncTask,
  SupervisorInstructionFinish,
  SupervisorInstructionParallelCallAgents,
} from './types';

export interface GroupOrchestrationSupervisorConfig {
  maxRounds: number;
  supervisorAgentId: string;
}

/**
 * GroupOrchestrationSupervisor - State machine for Multi-Agent Group Orchestration
 *
 * This is the "Brain" for Multi-Agent Group Orchestration.
 * It receives ExecutorResults and decides the next SupervisorInstruction.
 *
 * Decision Logic:
 * - init → call_supervisor (start the orchestration)
 * - supervisor_decided(speak) → call_agent
 * - supervisor_decided(broadcast) → parallel_call_agents
 * - supervisor_decided(delegate) → delegate
 * - supervisor_decided(execute_task) → exec_async_task
 * - supervisor_decided(execute_tasks) → batch_exec_async_tasks
 * - supervisor_decided(finish) → finish
 * - agent_spoke / agents_broadcasted / task_completed / tasks_completed → call_supervisor OR finish
 * - delegated → finish
 */
export class GroupOrchestrationSupervisor implements IGroupOrchestrationSupervisor {
  private round = 0;
  private skipCallSupervisor = false;

  constructor(private config: GroupOrchestrationSupervisorConfig) {}

  /**
   * Decide the next instruction based on the executor result
   */

  async decide(result: ExecutorResult, _state: AgentState): Promise<SupervisorInstruction> {
    switch (result.type) {
      case 'init': {
        this.round = 0;
        this.skipCallSupervisor = false;
        return {
          payload: {
            groupId: result.payload.groupId,
            round: this.round,
            supervisorAgentId: this.config.supervisorAgentId,
          },
          type: 'call_supervisor',
        } as SupervisorInstructionCallSupervisor;
      }

      case 'supervisor_decided': {
        const { decision, params, skipCallSupervisor } = result.payload;
        this.skipCallSupervisor = skipCallSupervisor ?? false;

        switch (decision) {
          case 'speak': {
            return {
              payload: {
                agentId: params.agentId as string,
                instruction: params.instruction as string | undefined,
              },
              type: 'call_agent',
            } as SupervisorInstructionCallAgent;
          }

          case 'broadcast': {
            return {
              payload: {
                agentIds: params.agentIds as string[],
                // Broadcast agents should not call tools by default
                disableTools: true,
                instruction: params.instruction as string | undefined,
                toolMessageId: params.toolMessageId as string,
              },
              type: 'parallel_call_agents',
            } as SupervisorInstructionParallelCallAgents;
          }

          case 'delegate': {
            return {
              payload: {
                agentId: params.agentId as string,
                reason: params.reason as string | undefined,
              },
              type: 'delegate',
            } as SupervisorInstructionDelegate;
          }

          case 'execute_task': {
            const instructionPayload = {
              agentId: params.agentId as string,
              instruction: params.instruction as string,
              timeout: params.timeout as number | undefined,
              title: params.title as string | undefined,
              toolMessageId: params.toolMessageId as string,
            };

            // Return different instruction type based on runInClient flag
            if (params.runInClient) {
              return {
                payload: instructionPayload,
                type: 'exec_client_async_task',
              } as SupervisorInstructionExecClientAsyncTask;
            }

            return {
              payload: instructionPayload,
              type: 'exec_async_task',
            } as SupervisorInstructionExecAsyncTask;
          }

          case 'execute_tasks': {
            return {
              payload: {
                tasks: params.tasks as Array<{
                  agentId: string;
                  instruction: string;
                  timeout?: number;
                  title?: string;
                }>,
                toolMessageId: params.toolMessageId as string,
              },
              type: 'batch_exec_async_tasks',
            } as SupervisorInstructionBatchExecAsyncTasks;
          }

          case 'finish': {
            return {
              reason: (params.reason as string) || 'supervisor_finished',
              type: 'finish',
            } as SupervisorInstructionFinish;
          }

          default: {
            return { reason: `unknown_decision: ${decision}`, type: 'finish' };
          }
        }
      }

      // These results all follow the same logic: check skip/maxRounds, then call_supervisor or finish
      case 'agent_spoke':
      case 'agents_broadcasted':
      case 'task_completed':
      case 'tasks_completed': {
        if (this.skipCallSupervisor) {
          return { reason: 'skip_call_supervisor', type: 'finish' };
        }

        this.round++;
        if (this.round >= this.config.maxRounds) {
          return { reason: 'max_rounds_exceeded', type: 'finish' };
        }

        return {
          payload: {
            round: this.round,
            supervisorAgentId: this.config.supervisorAgentId,
          },
          type: 'call_supervisor',
        } as SupervisorInstructionCallSupervisor;
      }

      case 'delegated': {
        return { reason: `delegated_to_${result.payload.agentId}`, type: 'finish' };
      }

      default: {
        return { reason: 'unknown_result_type', type: 'finish' };
      }
    }
  }
}
