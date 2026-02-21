import {
  type GroupOrchestrationEvent,
  type GroupOrchestrationExecutor,
  type GroupOrchestrationExecutorOutput,
  type SupervisorInstruction,
  type SupervisorInstructionBatchExecAsyncTasks,
  type SupervisorInstructionCallAgent,
  type SupervisorInstructionCallSupervisor,
  type SupervisorInstructionDelegate,
  type SupervisorInstructionExecAsyncTask,
  type SupervisorInstructionExecClientAsyncTask,
  type SupervisorInstructionParallelCallAgents,
} from '@lobechat/agent-runtime';
import { type ConversationContext, type UIChatMessage } from '@lobechat/types';
import debug from 'debug';

import { aiAgentService } from '@/services/aiAgent';
import { dbMessageSelectors } from '@/store/chat/slices/message/selectors';
import { type ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

const log = debug('lobe-store:group-orchestration-executors');

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export interface GroupOrchestrationExecutorsContext {
  get: () => ChatStore;
  /**
   * Message context for fetching messages
   * Contains agentId (groupId for group chat), topicId, scope, etc.
   */
  messageContext: ConversationContext;
  orchestrationOperationId: string;
  supervisorAgentId: string;
}

/**
 * Creates executors for Group Orchestration
 *
 * Architecture:
 * - Supervisor (State Machine): Receives ExecutorResult → Returns SupervisorInstruction
 * - Executor (Execution Layer): Receives SupervisorInstruction → Returns ExecutorResult
 *
 * Flow:
 * ```
 * Supervisor.decide(init)
 *        │
 *        └─► call_supervisor instruction
 *                │
 *                └─► call_supervisor Executor
 *                        │
 *                        ├─► internal_execAgentRuntime(Supervisor)
 *                        │        │
 *                        │        ├─► Supervisor calls speak tool
 *                        │        │        │
 *                        │        │        └─► tool handler triggers orchestration
 *                        │        │
 *                        │        └─► Supervisor finishes normally
 *                        │
 *                        └─► Returns supervisor_decided result
 *                                │
 *                                └─► Supervisor.decide(supervisor_decided)
 *                                        │
 *                                        └─► call_agent instruction
 *                                                │
 *                                                └─► call_agent Executor
 *                                                        │
 *                                                        └─► Returns agent_spoke result
 *                                                                │
 *                                                                └─► Supervisor.decide(agent_spoke)
 *                                                                        │
 *                                                                        └─► call_supervisor OR finish
 * ```
 */
export const createGroupOrchestrationExecutors = (
  context: GroupOrchestrationExecutorsContext,
): Partial<Record<SupervisorInstruction['type'], GroupOrchestrationExecutor>> => {
  const { get, messageContext, orchestrationOperationId, supervisorAgentId } = context;

  // Pre-compute the chat key for message fetching
  const chatKey = messageMapKey(messageContext);

  /**
   * Helper to get current messages for the group conversation
   */
  const getMessages = () => dbMessageSelectors.getDbMessagesByKey(chatKey)(get());

  /* eslint-disable sort-keys-fix/sort-keys-fix */

  return {
    /**
     * call_supervisor Executor
     * Executes the Supervisor Agent completely
     *
     * Returns: supervisor_decided result with the decision made by supervisor
     *
     * Note: When Supervisor calls a group-management tool (speak/broadcast/delegate),
     * the tool returns `stop: true` which terminates the AgentRuntime.
     * The tool also registers an afterCompletion callback to trigger the orchestration.
     */
    call_supervisor: async (instruction, state): Promise<GroupOrchestrationExecutorOutput> => {
      const { supervisorAgentId: agentId } = (instruction as SupervisorInstructionCallSupervisor)
        .payload;

      const sessionLogId = `${state.operationId}:call_supervisor`;
      log(`[${sessionLogId}] Starting supervisor agent: ${agentId}`);

      const messages = getMessages();
      const lastMessage = messages.at(-1);

      if (!lastMessage) {
        log(`[${sessionLogId}] No messages found, cannot execute supervisor`);
        return {
          events: [{ type: 'supervisor_finished' }] as GroupOrchestrationEvent[],
          newState: { ...state, status: 'done' },
          // Supervisor finished without action - end orchestration
          result: undefined,
        };
      }

      // Execute Supervisor agent with the supervisor's agentId in context
      // Mark isSupervisor=true so assistant messages get metadata.isSupervisor for UI rendering
      // Note: Don't pass operationId - let it create a new child operation (same as call_agent)
      // This ensures each call has its own immutable context with isSupervisor properly set
      await get().internal_execAgentRuntime({
        context: { ...messageContext, agentId: supervisorAgentId, isSupervisor: true },
        messages,
        parentMessageId: lastMessage.id,
        parentMessageType: lastMessage.role as 'user' | 'assistant' | 'tool',
        parentOperationId: orchestrationOperationId,
      });

      log(`[${sessionLogId}] Supervisor agent finished`);

      // If no tool was called (supervisor finished normally), end orchestration
      // The actual decision is captured via the afterCompletion callbacks
      // For now, return a finish decision if we reach here
      return {
        events: [{ type: 'supervisor_finished' }] as GroupOrchestrationEvent[],
        newState: state,
        result: {
          payload: {
            decision: 'finish',
            params: { reason: 'supervisor_completed_without_action' },
            skipCallSupervisor: false,
          },
          type: 'supervisor_decided',
        },
      };
    },

    /**
     * call_agent Executor
     * Executes a single target Agent completely
     *
     * Returns: agent_spoke result
     *
     * If the Supervisor provides an instruction, it will be injected as a virtual
     * User Message at the end of the messages array. This improves instruction-following
     * as User Messages have stronger influence on model behavior.
     */
    call_agent: async (instruction, state): Promise<GroupOrchestrationExecutorOutput> => {
      const { agentId, instruction: agentInstruction } = (
        instruction as SupervisorInstructionCallAgent
      ).payload;

      const sessionLogId = `${state.operationId}:call_agent`;
      log(`[${sessionLogId}] Calling agent: ${agentId}, instruction: ${agentInstruction}`);

      const messages = getMessages();
      const lastMessage = messages.at(-1);

      if (!lastMessage) {
        log(`[${sessionLogId}] No messages found, cannot execute agent`);
        return {
          events: [{ agentId, type: 'agent_spoke' }] as GroupOrchestrationEvent[],
          newState: state,
          result: { payload: { agentId, completed: true }, type: 'agent_spoke' },
        };
      }

      // If instruction is provided, inject it as a virtual User Message
      // This virtual message is not persisted to database, only used for model context
      // Mark with <speaker> tag so the agent knows this instruction is from the Supervisor
      const now = Date.now();
      const messagesWithInstruction: UIChatMessage[] = agentInstruction
        ? [
            ...messages,
            {
              content: `<speaker name="Supervisor" />\n${agentInstruction}`,
              createdAt: now,
              id: `virtual_speak_instruction_${now}`,
              role: 'user',
              updatedAt: now,
            },
          ]
        : messages;

      // Execute target Agent with subAgentId for agent config retrieval
      // - messageContext keeps the group's main conversation context (for message storage)
      // - subAgentId specifies which agent's config to use
      await get().internal_execAgentRuntime({
        context: { ...messageContext, subAgentId: agentId },
        messages: messagesWithInstruction,
        parentMessageId: lastMessage.id,
        parentMessageType: lastMessage.role as 'user' | 'assistant' | 'tool',
        parentOperationId: orchestrationOperationId,
      });

      log(`[${sessionLogId}] Agent ${agentId} finished speaking`);

      // Return agent_spoke result
      return {
        events: [{ agentId, type: 'agent_spoke' }] as GroupOrchestrationEvent[],
        newState: state,
        result: {
          payload: { agentId, completed: true },
          type: 'agent_spoke',
        },
      };
    },

    /**
     * parallel_call_agents Executor
     * Executes multiple Agents in parallel
     *
     * Returns: agents_broadcasted result
     *
     * If the Supervisor provides an instruction, it will be injected as a virtual
     * User Message at the end of the messages array. This improves instruction-following
     * as User Messages have stronger influence on model behavior.
     */
    parallel_call_agents: async (instruction, state): Promise<GroupOrchestrationExecutorOutput> => {
      const {
        agentIds,
        disableTools,
        instruction: agentInstruction,
        toolMessageId,
      } = (instruction as SupervisorInstructionParallelCallAgents).payload;

      const sessionLogId = `${state.operationId}:parallel_call_agents`;
      log(
        `[${sessionLogId}] Broadcasting to agents: ${agentIds.join(', ')}, instruction: ${agentInstruction}, toolMessageId: ${toolMessageId}, disableTools: ${disableTools}`,
      );

      const messages = getMessages();

      if (messages.length === 0) {
        log(`[${sessionLogId}] No messages found, cannot execute agents`);
        return {
          events: [{ agentIds, type: 'agents_broadcasted' }] as GroupOrchestrationEvent[],
          newState: state,
          result: {
            payload: { agentIds, completed: true },
            type: 'agents_broadcasted',
          },
        };
      }

      // If instruction is provided, inject it as a virtual User Message
      // This virtual message is not persisted to database, only used for model context
      // Mark with <speaker> tag so the agent knows this instruction is from the Supervisor
      const now = Date.now();
      const messagesWithInstruction: UIChatMessage[] = agentInstruction
        ? [
            ...messages,
            {
              content: `<speaker name="Supervisor" />\n${agentInstruction}`,
              createdAt: now,
              id: `virtual_broadcast_instruction_${now}`,
              role: 'user',
              updatedAt: now,
            },
          ]
        : messages;

      // Execute all Agents in parallel, each with their own subAgentId for config retrieval
      // - messageContext keeps the group's main conversation context (for message storage)
      // - subAgentId specifies which agent's config to use for each agent
      // - toolMessageId is used as parentMessageId so agent responses are children of the tool message
      // - disableTools prevents broadcast agents from calling tools (expected behavior for broadcast)
      await Promise.all(
        agentIds.map(async (agentId) => {
          await get().internal_execAgentRuntime({
            context: { ...messageContext, subAgentId: agentId },
            disableTools,
            messages: messagesWithInstruction,
            parentMessageId: toolMessageId,
            parentMessageType: 'tool',
            parentOperationId: orchestrationOperationId,
          });
        }),
      );

      log(`[${sessionLogId}] All agents finished broadcasting`);

      // Return agents_broadcasted result
      return {
        events: [{ agentIds, type: 'agents_broadcasted' }] as GroupOrchestrationEvent[],
        newState: state,
        result: {
          payload: { agentIds, completed: true },
          type: 'agents_broadcasted',
        },
      };
    },

    /**
     * delegate Executor
     * Delegates control to another agent
     *
     * Returns: delegated result
     */
    delegate: async (instruction, state): Promise<GroupOrchestrationExecutorOutput> => {
      const { agentId, reason } = (instruction as SupervisorInstructionDelegate).payload;

      const sessionLogId = `${state.operationId}:delegate`;
      log(`[${sessionLogId}] Delegating to agent: ${agentId}, reason: ${reason}`);

      const messages = getMessages();
      const lastMessage = messages.at(-1);

      if (!lastMessage) {
        log(`[${sessionLogId}] No messages found, cannot delegate`);
        return {
          events: [] as GroupOrchestrationEvent[],
          newState: state,
          result: {
            payload: { agentId, completed: true },
            type: 'delegated',
          },
        };
      }

      // Execute delegated Agent
      await get().internal_execAgentRuntime({
        context: { ...messageContext, subAgentId: agentId },
        messages,
        parentMessageId: lastMessage.id,
        parentMessageType: lastMessage.role as 'user' | 'assistant' | 'tool',
        parentOperationId: orchestrationOperationId,
      });

      log(`[${sessionLogId}] Delegated agent ${agentId} finished`);

      // Return delegated result
      return {
        events: [] as GroupOrchestrationEvent[],
        newState: state,
        result: {
          payload: { agentId, completed: true },
          type: 'delegated',
        },
      };
    },

    /**
     * exec_async_task Executor
     * Executes an async task for an agent using aiAgentService with polling (server-side)
     *
     * Flow:
     * 1. Create a task message (role: 'task') as placeholder
     * 2. Call execGroupSubAgentTask API (backend creates thread with sourceMessageId)
     * 3. Poll for task completion
     * 4. Update task message content with summary on completion
     *
     * Returns: task_completed result
     */
    exec_async_task: async (
      supervisorInstruction,
      state,
    ): Promise<GroupOrchestrationExecutorOutput> => {
      const { agentId, instruction, timeout, title, toolMessageId } = (
        supervisorInstruction as SupervisorInstructionExecAsyncTask
      ).payload;

      const sessionLogId = `${state.operationId}:exec_async_task`;
      log(
        `[${sessionLogId}] Executing async task for agent: ${agentId}, instruction: ${instruction}, timeout: ${timeout}`,
      );

      const { groupId, topicId } = messageContext;

      if (!groupId || !topicId) {
        log(`[${sessionLogId}] No valid context, cannot execute async task`, groupId, topicId);
        return {
          events: [] as GroupOrchestrationEvent[],
          newState: state,
          result: {
            payload: { agentId, error: 'No valid context available', success: false },
            type: 'task_completed',
          },
        };
      }

      try {
        // 1. Create task message as placeholder
        const taskMessageResult = await get().optimisticCreateMessage(
          {
            agentId,
            content: '',
            groupId,
            metadata: { instruction, taskTitle: title },
            parentId: toolMessageId,
            role: 'task',
            topicId,
          },
          { operationId: state.operationId },
        );

        if (!taskMessageResult) {
          console.error(`[${sessionLogId}] Failed to create task message`);
          return {
            events: [] as GroupOrchestrationEvent[],
            newState: state,
            result: {
              payload: { agentId, error: 'Failed to create task message', success: false },
              type: 'task_completed',
            },
          };
        }

        const taskMessageId = taskMessageResult.id;
        log(`[${sessionLogId}] Created task message: ${taskMessageId}`);

        // 2. Create task via backend API (backend creates thread with sourceMessageId)
        const createResult = await aiAgentService.execSubAgentTask({
          agentId,
          groupId,
          instruction,
          parentMessageId: taskMessageId,
          title,
          topicId,
        });

        if (!createResult.success) {
          log(`[${sessionLogId}] Failed to create task: ${createResult.error}`);
          // Update task message with error
          await get().optimisticUpdateMessageContent(
            taskMessageId,
            `Task creation failed: ${createResult.error}`,
            undefined,
            { operationId: state.operationId },
          );
          return {
            events: [] as GroupOrchestrationEvent[],
            newState: state,
            result: {
              payload: { agentId, error: createResult.error, success: false },
              type: 'task_completed',
            },
          };
        }

        log(`[${sessionLogId}] Task created with threadId: ${createResult.threadId}`);

        // 3. Poll for task completion
        const pollInterval = 3000; // 3 seconds
        const maxWait = timeout || 1_800_000; // Default 30 minutes
        const startTime = Date.now();

        while (Date.now() - startTime < maxWait) {
          // Check if operation has been cancelled
          const currentOperation = get().operations[state.operationId];
          if (currentOperation?.status === 'cancelled') {
            console.warn(`[${sessionLogId}] Operation cancelled, stopping polling`);
            return {
              events: [] as GroupOrchestrationEvent[],
              newState: { ...state, status: 'done' },
              result: {
                payload: { agentId, error: 'Operation cancelled', success: false },
                type: 'task_completed',
              },
            };
          }

          const status = await aiAgentService.getSubAgentTaskStatus({
            threadId: createResult.threadId,
          });

          // Update taskDetail in message if available
          if (status.taskDetail) {
            get().internal_dispatchMessage(
              {
                id: taskMessageId,
                type: 'updateMessage',
                value: { taskDetail: status.taskDetail },
              },
              { operationId: state.operationId },
            );
            log(`[${sessionLogId}] Updated task message with taskDetail`);
          }

          if (status.status === 'completed') {
            log(`[${sessionLogId}] Task completed successfully`);
            // 4. Update task message with summary
            if (status.result) {
              await get().optimisticUpdateMessageContent(taskMessageId, status.result, undefined, {
                operationId: state.operationId,
              });
            }
            return {
              events: [] as GroupOrchestrationEvent[],
              newState: state,
              result: {
                payload: { agentId, result: status.result, success: true },
                type: 'task_completed',
              },
            };
          }

          if (status.status === 'failed') {
            console.error(`[${sessionLogId}] Task failed: ${status.error}`);
            // Update task message with error
            await get().optimisticUpdateMessageContent(
              taskMessageId,
              `Task failed: ${status.error}`,
              undefined,
              { operationId: state.operationId },
            );
            return {
              events: [] as GroupOrchestrationEvent[],
              newState: state,
              result: {
                payload: { agentId, error: status.error, success: false },
                type: 'task_completed',
              },
            };
          }

          if (status.status === 'cancel') {
            log(`[${sessionLogId}] Task was cancelled`);
            // Update task message with cancelled status
            await get().optimisticUpdateMessageContent(
              taskMessageId,
              'Task was cancelled',
              undefined,
              { operationId: state.operationId },
            );
            return {
              events: [] as GroupOrchestrationEvent[],
              newState: state,
              result: {
                payload: { agentId, error: 'Task was cancelled', success: false },
                type: 'task_completed',
              },
            };
          }

          // Still processing, wait and poll again
          await sleep(pollInterval);
        }

        // Timeout reached
        log(`[${sessionLogId}] Task timeout after ${maxWait}ms`);
        // Update task message with timeout error
        await get().optimisticUpdateMessageContent(
          taskMessageId,
          `Task timeout after ${maxWait}ms`,
          undefined,
          { operationId: state.operationId },
        );

        return {
          events: [] as GroupOrchestrationEvent[],
          newState: state,
          result: {
            payload: { agentId, error: `Task timeout after ${maxWait}ms`, success: false },
            type: 'task_completed',
          },
        };
      } catch (error) {
        log(`[${sessionLogId}] Error executing async task: ${error}`);
        return {
          events: [] as GroupOrchestrationEvent[],
          newState: state,
          result: {
            payload: {
              agentId,
              error: error instanceof Error ? error.message : 'Unknown error',
              success: false,
            },
            type: 'task_completed',
          },
        };
      }
    },

    /**
     * exec_client_async_task Executor
     * Executes an async task for an agent on the client (desktop only)
     * Used when task requires local tools like file system or shell commands
     *
     * Flow:
     * 1. Create a task message (role: 'task') as placeholder
     * 2. Create Thread via API (to get threadId for operation context)
     * 3. Execute using internal_execAgentRuntime (client-side with local tools access)
     * 4. Update Thread status via API on completion
     * 5. Update task message content with result
     *
     * Returns: task_completed result
     */
    exec_client_async_task: async (
      supervisorInstruction,
      state,
    ): Promise<GroupOrchestrationExecutorOutput> => {
      const { agentId, instruction, title, toolMessageId } = (
        supervisorInstruction as SupervisorInstructionExecClientAsyncTask
      ).payload;

      const sessionLogId = `${state.operationId}:exec_client_async_task`;
      log(`[${sessionLogId}] Executing client-side async task for agent: ${agentId}`);

      const { groupId, topicId } = messageContext;

      if (!groupId || !topicId) {
        log(`[${sessionLogId}] No valid context, cannot execute client async task`);
        return {
          events: [] as GroupOrchestrationEvent[],
          newState: state,
          result: {
            payload: { agentId, error: 'No valid context available', success: false },
            type: 'task_completed',
          },
        };
      }

      try {
        // 1. Create task message as placeholder
        const taskMessageResult = await get().optimisticCreateMessage(
          {
            agentId,
            content: '',
            groupId,
            metadata: { instruction, taskTitle: title },
            parentId: toolMessageId,
            role: 'task',
            topicId,
          },
          { operationId: state.operationId },
        );

        if (!taskMessageResult) {
          console.error(`[${sessionLogId}] Failed to create task message`);
          return {
            events: [] as GroupOrchestrationEvent[],
            newState: state,
            result: {
              payload: { agentId, error: 'Failed to create task message', success: false },
              type: 'task_completed',
            },
          };
        }

        const taskMessageId = taskMessageResult.id;
        log(`[${sessionLogId}] Created task message: ${taskMessageId}`);

        // 2. Create Thread via API first (to get threadId for operation context)
        // Use Group-specific API that handles different agentIds in thread context
        const threadResult = await aiAgentService.createClientGroupAgentTaskThread({
          groupId: groupId!,
          instruction,
          parentMessageId: taskMessageId,
          subAgentId: agentId,
          title,
          topicId,
        });

        if (!threadResult.success) {
          log(`[${sessionLogId}] Failed to create client task thread`);
          await get().optimisticUpdateMessageContent(
            taskMessageId,
            'Failed to create task thread',
            undefined,
            { operationId: state.operationId },
          );
          return {
            events: [] as GroupOrchestrationEvent[],
            newState: state,
            result: {
              payload: { agentId, error: 'Failed to create client task thread', success: false },
              type: 'task_completed',
            },
          };
        }

        const { threadId, userMessageId, threadMessages, messages } = threadResult;
        log(
          `[${sessionLogId}] Created thread: ${threadId}, userMessageId: ${userMessageId}, threadMessages: ${threadMessages.length}`,
        );

        // 3. Build sub-task ConversationContext (uses threadId for isolation)
        const subContext: ConversationContext = {
          agentId,
          groupId,
          topicId,
          threadId,
          scope: 'thread',
        };

        // 4. Create a child operation for task execution (now with threadId)
        const { operationId: taskOperationId } = get().startOperation({
          type: 'execClientTask',
          context: subContext,
          parentOperationId: orchestrationOperationId,
          metadata: {
            startTime: Date.now(),
            taskDescription: title,
            taskMessageId,
            executionMode: 'client',
          },
        });

        // 5. Sync messages to store
        // Update main chat messages with latest taskDetail status (use messageContext for Group)
        const mainKey = messageMapKey(messageContext);
        log(
          `[${sessionLogId}] replaceMessages (main): messages=%d, key=%s, context=%O`,
          messages.length,
          mainKey,
          messageContext,
        );
        get().replaceMessages(messages, { context: messageContext });

        // Update thread messages
        const threadKey = messageMapKey(subContext);
        log(
          `[${sessionLogId}] replaceMessages (thread): threadMessages=%d, key=%s, subContext=%O`,
          threadMessages.length,
          threadKey,
          subContext,
        );
        get().replaceMessages(threadMessages, { context: subContext });

        // 6. Execute using internal_execAgentRuntime (client-side with local tools access)
        log(`[${sessionLogId}] Starting client-side AgentRuntime execution`);

        const runtimeResult = await get().internal_execAgentRuntime({
          context: subContext,
          messages: threadMessages,
          parentMessageId: userMessageId, // Use server-returned userMessageId
          parentMessageType: 'user',
          operationId: taskOperationId,
          parentOperationId: orchestrationOperationId,
          isSubTask: true, // Disable lobe-gtd tools to prevent nested sub-tasks
        });

        log(`[${sessionLogId}] Client-side AgentRuntime execution completed`);

        // 7. Get execution result from sub-task messages
        const subMessageKey = messageMapKey(subContext);
        const subTaskMessages = get().dbMessagesMap[subMessageKey] || [];
        const lastAssistant = subTaskMessages.findLast((m) => m.role === 'assistant');
        const resultContent = lastAssistant?.content || 'Task completed';

        log(`[${sessionLogId}] Got result from sub-task: ${resultContent.length} chars`);

        // Count tool calls
        const totalToolCalls = subTaskMessages.filter((m) => m.role === 'tool').length;

        // Get usage data from runtime result
        const { usage, cost } = runtimeResult || {};

        // 8. Update task message with result
        await get().optimisticUpdateMessageContent(
          taskMessageId,
          resultContent,
          {
            metadata: {
              cost: cost?.total,
              duration: usage?.llm?.processingTimeMs,
              totalInputTokens: usage?.llm?.tokens?.input,
              totalOutputTokens: usage?.llm?.tokens?.output,
              totalTokens: usage?.llm?.tokens?.total,
            },
          },
          { operationId: state.operationId },
        );

        // 9. Update Thread status via API with metadata
        await aiAgentService.updateClientTaskThreadStatus({
          threadId,
          completionReason: 'done',
          resultContent,
          metadata: {
            totalCost: cost?.total,
            totalMessages: subTaskMessages.length,
            totalTokens: usage?.llm?.tokens?.total,
            totalToolCalls,
          },
        });

        // 10. Complete operation
        get().completeOperation(taskOperationId);

        return {
          events: [] as GroupOrchestrationEvent[],
          newState: state,
          result: {
            payload: { agentId, result: resultContent, success: true },
            type: 'task_completed',
          },
        };
      } catch (error) {
        log(`[${sessionLogId}] Error executing client async task: ${error}`);
        return {
          events: [] as GroupOrchestrationEvent[],
          newState: state,
          result: {
            payload: {
              agentId,
              error: error instanceof Error ? error.message : 'Unknown error',
              success: false,
            },
            type: 'task_completed',
          },
        };
      }
    },

    /**
     * batch_exec_async_tasks Executor
     * Executes multiple async tasks for agents in parallel using aiAgentService with polling
     *
     * Flow:
     * 1. Create task messages (role: 'task') for each task as placeholders
     * 2. Call execSubAgentTask API for each task in parallel
     * 3. Poll for all tasks completion
     * 4. Update task messages with results on completion
     *
     * Returns: tasks_completed result
     */
    batch_exec_async_tasks: async (
      instruction,
      state,
    ): Promise<GroupOrchestrationExecutorOutput> => {
      const { tasks, toolMessageId } = (instruction as SupervisorInstructionBatchExecAsyncTasks)
        .payload;

      const sessionLogId = `${state.operationId}:batch_exec_async_tasks`;
      log(`[${sessionLogId}] Executing ${tasks.length} async tasks in parallel`);

      const { groupId, topicId } = messageContext;

      if (!groupId || !topicId) {
        log(`[${sessionLogId}] No valid context, cannot execute async tasks`, groupId, topicId);
        return {
          events: [] as GroupOrchestrationEvent[],
          newState: state,
          result: {
            payload: {
              results: tasks.map((t) => ({
                agentId: t.agentId,
                error: 'No valid context available',
                success: false,
              })),
            },
            type: 'tasks_completed',
          },
        };
      }

      // Track all tasks with their messages and thread IDs
      interface TaskTracker {
        agentId: string;
        error?: string;
        instruction: string;
        result?: string;
        status: 'pending' | 'running' | 'completed' | 'failed';
        taskMessageId?: string;
        threadId?: string;
        timeout: number;
        title?: string;
      }

      const taskTrackers: TaskTracker[] = tasks.map((t) => ({
        agentId: t.agentId,
        status: 'pending',
        instruction: t.instruction,
        timeout: t.timeout || 1_800_000, // Default 30 minutes
        title: t.title,
      }));

      // 1. Create task messages for all tasks in parallel
      await Promise.all(
        taskTrackers.map(async (tracker, index) => {
          const taskLogId = `${sessionLogId}:task-${index}`;
          try {
            const taskMessageResult = await get().optimisticCreateMessage(
              {
                agentId: tracker.agentId,
                content: '',
                createdAt: Date.now() + index,
                groupId,
                metadata: { instruction: tracker.instruction, taskTitle: tracker.title },
                parentId: toolMessageId,
                role: 'task',
                topicId,
              },
              { operationId: state.operationId },
            );

            if (taskMessageResult) {
              tracker.taskMessageId = taskMessageResult.id;
              log(`[${taskLogId}] Created task message: ${tracker.taskMessageId}`);
            } else {
              tracker.status = 'failed';
              tracker.error = 'Failed to create task message';
              console.error(`[${taskLogId}] Failed to create task message`);
            }
          } catch (error) {
            tracker.status = 'failed';
            tracker.error = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[${taskLogId}] Error creating task message: ${error}`);
          }
        }),
      );

      // 2. Start all tasks in parallel via backend API
      await Promise.all(
        taskTrackers.map(async (tracker, index) => {
          if (tracker.status === 'failed' || !tracker.taskMessageId) return;

          const taskLogId = `${sessionLogId}:task-${index}`;
          try {
            const createResult = await aiAgentService.execSubAgentTask({
              agentId: tracker.agentId,
              groupId,
              instruction: tracker.instruction,
              parentMessageId: tracker.taskMessageId,
              title: tracker.title,
              topicId,
            });

            if (createResult.success) {
              tracker.threadId = createResult.threadId;
              tracker.status = 'running';
              log(`[${taskLogId}] Task started with threadId: ${tracker.threadId}`);
            } else {
              tracker.status = 'failed';
              tracker.error = createResult.error;
              log(`[${taskLogId}] Failed to start task: ${createResult.error}`);
              // Update task message with error
              await get().optimisticUpdateMessageContent(
                tracker.taskMessageId,
                `Task creation failed: ${createResult.error}`,
                undefined,
                { operationId: state.operationId },
              );
            }
          } catch (error) {
            tracker.status = 'failed';
            tracker.error = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[${taskLogId}] Error starting task: ${error}`);
          }
        }),
      );

      // 3. Poll for all tasks completion
      const pollInterval = 3000; // 3 seconds
      const startTime = Date.now();
      const maxTimeout = Math.max(...taskTrackers.map((t) => t.timeout));

      while (Date.now() - startTime < maxTimeout) {
        // Check if operation has been cancelled
        const currentOperation = get().operations[state.operationId];
        if (currentOperation?.status === 'cancelled') {
          console.warn(`[${sessionLogId}] Operation cancelled, stopping polling`);
          return {
            events: [] as GroupOrchestrationEvent[],
            newState: { ...state, status: 'done' },
            result: {
              payload: {
                results: taskTrackers.map((t) => ({
                  agentId: t.agentId,
                  error: t.status === 'running' ? 'Operation cancelled' : t.error,
                  result: t.result,
                  success: t.status === 'completed',
                })),
              },
              type: 'tasks_completed',
            },
          };
        }

        // Check status of all running tasks
        const runningTasks = taskTrackers.filter((t) => t.status === 'running');
        if (runningTasks.length === 0) {
          // All tasks have completed or failed
          break;
        }

        await Promise.all(
          runningTasks.map(async (tracker, index) => {
            if (!tracker.threadId || !tracker.taskMessageId) return;

            const taskLogId = `${sessionLogId}:task-${index}`;
            try {
              const status = await aiAgentService.getSubAgentTaskStatus({
                threadId: tracker.threadId,
              });

              // Update taskDetail in message if available
              if (status.taskDetail) {
                get().internal_dispatchMessage(
                  {
                    id: tracker.taskMessageId,
                    type: 'updateMessage',
                    value: { taskDetail: status.taskDetail },
                  },
                  { operationId: state.operationId },
                );
              }

              switch (status.status) {
                case 'completed': {
                  tracker.status = 'completed';
                  tracker.result = status.result;
                  log(`[${taskLogId}] Task completed successfully`);
                  if (status.result) {
                    await get().optimisticUpdateMessageContent(
                      tracker.taskMessageId,
                      status.result,
                      undefined,
                      { operationId: state.operationId },
                    );
                  }

                  break;
                }
                case 'failed': {
                  tracker.status = 'failed';
                  tracker.error = status.error;
                  console.error(`[${taskLogId}] Task failed: ${status.error}`);
                  await get().optimisticUpdateMessageContent(
                    tracker.taskMessageId,
                    `Task failed: ${status.error}`,
                    undefined,
                    { operationId: state.operationId },
                  );

                  break;
                }
                case 'cancel': {
                  tracker.status = 'failed';
                  tracker.error = 'Task was cancelled';
                  log(`[${taskLogId}] Task was cancelled`);
                  await get().optimisticUpdateMessageContent(
                    tracker.taskMessageId,
                    'Task was cancelled',
                    undefined,
                    { operationId: state.operationId },
                  );

                  break;
                }
                // No default
              }

              // Check individual task timeout
              if (tracker.status === 'running' && Date.now() - startTime > tracker.timeout) {
                tracker.status = 'failed';
                tracker.error = `Task timeout after ${tracker.timeout}ms`;
                log(`[${taskLogId}] Task timeout`);
                await get().optimisticUpdateMessageContent(
                  tracker.taskMessageId,
                  `Task timeout after ${tracker.timeout}ms`,
                  undefined,
                  { operationId: state.operationId },
                );
              }
            } catch (error) {
              console.error(`[${taskLogId}] Error polling task status: ${error}`);
            }
          }),
        );

        // Wait before next poll
        await sleep(pollInterval);
      }

      // Mark any remaining running tasks as timed out
      for (const tracker of taskTrackers) {
        if (tracker.status === 'running' && tracker.taskMessageId) {
          tracker.status = 'failed';
          tracker.error = `Task timeout after ${tracker.timeout}ms`;
          await get().optimisticUpdateMessageContent(
            tracker.taskMessageId,
            `Task timeout after ${tracker.timeout}ms`,
            undefined,
            { operationId: state.operationId },
          );
        }
      }

      log(`[${sessionLogId}] All tasks completed`);

      return {
        events: [] as GroupOrchestrationEvent[],
        newState: state,
        result: {
          payload: {
            results: taskTrackers.map((t) => ({
              agentId: t.agentId,
              error: t.error,
              result: t.result,
              success: t.status === 'completed',
            })),
          },
          type: 'tasks_completed',
        },
      };
    },
  };
};
