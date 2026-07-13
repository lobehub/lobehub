import type {
  AgentEvent,
  AgentInstruction,
  AgentInstructionCompressContext,
  AgentInstructionExecSubAgent,
  AgentInstructionExecSubAgents,
  AgentRuntimeContext,
  AgentRuntimeHost,
  GeneralAgentCompressionResultPayload,
  InstructionExecutor,
  SubAgentResultPayload,
  SubAgentsBatchResultPayload,
  SubAgentTask,
} from '@lobechat/agent-runtime';
import {
  callLlm as createCallLlmExecutor,
  callTool as createCallToolExecutor,
  finish as createFinishExecutor,
  requestHumanApprove as createRequestHumanApproveExecutor,
  resolveAbortedTools as createResolveAbortedToolsExecutor,
} from '@lobechat/agent-runtime';
import { countContextTokens, type ToolsEngine } from '@lobechat/context-engine';
import { chainCompressContext } from '@lobechat/prompts';
import { type MessageMetadata } from '@lobechat/types';
import debug from 'debug';
import pMap from 'p-map';

import { aiAgentService } from '@/services/aiAgent';
import { chatService } from '@/services/chat';
import { type ResolvedAgentConfig } from '@/services/chat/mecha';
import { messageService } from '@/services/message';
import { type ChatStore } from '@/store/chat/store';
import { getCompressionCandidateMessageIds } from '@/store/chat/utils/compression';
import { sleep } from '@/utils/sleep';

import { buildClientRuntimeHost } from './transports/buildClientRuntimeHost';

const log = debug('lobe-store:agent-executors');

const isAbortError = (error: unknown, abortController?: AbortController) =>
  !!abortController?.signal.aborted ||
  (error instanceof Error &&
    (error.name === 'AbortError' ||
      error.message.includes('aborted') ||
      error.message.includes('cancelled')));

const createAbortError = () =>
  Object.assign(new Error('Compression cancelled'), { name: 'AbortError' });

const formatSubAgentBatchResultContent = (
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

/**
 * Creates custom executors for the Chat Agent Runtime
 * These executors wrap existing chat store methods to integrate with agent-runtime
 *
 * @param context.operationId - Operation ID to get business context (agentId, topicId, etc.)
 * @param context.get - Store getter function
 * @param context.messageKey - Message map key
 * @param context.parentId - Parent message ID
 */
export const createAgentExecutors = (context: {
  /** Pre-resolved agent config with isSubAgent filtering applied */
  agentConfig: ResolvedAgentConfig;
  get: () => ChatStore;
  metadata?: Pick<MessageMetadata, 'trigger'>;
  messageKey: string;
  operationId: string;
  parentId: string;
  /** ToolsEngine for expanding dynamically activated tools */
  toolsEngine?: ToolsEngine;
}) => {
  /**
   * Get operation context via closure
   * Returns the business context (agentId, topicId, etc.) captured by the operation
   */
  const getOperationContext = () => {
    const operation = context.get().operations[context.operationId];
    if (!operation) {
      throw new Error(`Operation not found: ${context.operationId}`);
    }
    return operation.context;
  };

  /**
   * Get effective agentId for message creation - depends on scope
   * - scope: 'sub_agent': agentId stays unchanged (subAgentId only for config/display)
   * - Other scopes with subAgentId: use subAgentId for message ownership (e.g., Group mode)
   * - Default: use agentId
   */
  const getEffectiveAgentId = () => {
    const opContext = getOperationContext();

    // Use subAgentId for message ownership except in sub_agent scope
    // - sub_agent scope: callAgent scenario, message.agentId should stay unchanged
    // - Other scopes with subAgentId: Group mode, message.agentId should be subAgentId
    return opContext.subAgentId && opContext.scope !== 'sub_agent'
      ? opContext.subAgentId
      : opContext.agentId;
  };

  const usePackageExecutor =
    (factory: (host: AgentRuntimeHost) => InstructionExecutor): InstructionExecutor =>
    (instruction, state, runtimeContext) =>
      factory(
        buildClientRuntimeHost({
          agentConfig: context.agentConfig,
          get: context.get,
          metadata: context.metadata,
          messageKey: context.messageKey,
          operationId: context.operationId,
          runtimeContext,
          stepIndex: state.stepCount,
          toolsEngine: context.toolsEngine,
        }),
      )(instruction, state, runtimeContext);

  const executors: Partial<Record<AgentInstruction['type'], InstructionExecutor>> = {
    call_llm: usePackageExecutor(createCallLlmExecutor),

    call_tool: usePackageExecutor(createCallToolExecutor),

    finish: usePackageExecutor(createFinishExecutor),

    request_human_approve: usePackageExecutor(createRequestHumanApproveExecutor),

    resolve_aborted_tools: usePackageExecutor(createResolveAbortedToolsExecutor),

    /**
     * exec_sub_agent executor
     * Dispatches a single sub-agent
     *
     * Flow:
     * 1. Call execSubAgentTask API (backend creates thread)
     * 2. Poll for sub-agent completion
     * 3. Update the source tool message with result on completion
     * 4. Return sub_agent_result phase with result
     */
    exec_sub_agent: async (instruction, state) => {
      const { parentMessageId, task } = (instruction as AgentInstructionExecSubAgent).payload;

      const events: AgentEvent[] = [];
      const sessionLogId = `${state.operationId}:${state.stepCount}`;

      log('[%s][exec_sub_agent] Starting execution of task: %s', sessionLogId, task.description);

      // Get context from operation
      const opContext = getOperationContext();
      const { agentId, topicId } = opContext;

      // Check for targetAgentId (callAgent mode)
      const targetAgentId = (task as any).targetAgentId;
      const executionAgentId = targetAgentId || agentId;

      if (!agentId || !topicId || !executionAgentId) {
        log('[%s][exec_sub_agent] No valid context, cannot execute task', sessionLogId);
        return {
          events,
          newState: state,
          nextContext: {
            payload: {
              parentMessageId,
              result: {
                error: 'No valid context available',
                success: false,
                threadId: '',
              },
            } as SubAgentResultPayload,
            phase: 'sub_agent_result',
            session: {
              messageCount: state.messages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          } as AgentRuntimeContext,
        };
      }

      if (targetAgentId) {
        log(
          '[%s][exec_sub_agent] callAgent mode - current agent: %s, target agent: %s',
          sessionLogId,
          agentId,
          targetAgentId,
        );
      }

      const taskLogId = `${sessionLogId}:task`;

      try {
        const resultMessageId = parentMessageId;

        // 1. Create and execute task on server
        // IMPORTANT: Use executionAgentId here (targetAgentId if in callAgent mode)
        // This ensures the task executes with the correct agent's config
        log('[%s] Using server-side execution with agentId: %s', taskLogId, executionAgentId);
        const createResult = await aiAgentService.execSubAgentTask({
          agentId: executionAgentId, // Use targetAgentId for callAgent, or current agentId for sub-agent dispatch
          instruction: task.instruction,
          parentMessageId: resultMessageId,
          title: task.description,
          topicId,
        });

        if (!createResult.success) {
          log('[%s] Failed to create task: %s', taskLogId, createResult.error);
          await context
            .get()
            .optimisticUpdateMessageContent(
              resultMessageId,
              `Task creation failed: ${createResult.error}`,
              undefined,
              { operationId: state.operationId },
            );
          return {
            events,
            newState: state,
            nextContext: {
              payload: {
                parentMessageId,
                result: {
                  error: createResult.error,
                  success: false,
                  threadId: '',
                },
              } as SubAgentResultPayload,
              phase: 'sub_agent_result',
              session: {
                messageCount: state.messages.length,
                sessionId: state.operationId,
                status: 'running',
                stepCount: state.stepCount + 1,
              },
            } as AgentRuntimeContext,
          };
        }

        log('[%s] Task created with threadId: %s', taskLogId, createResult.threadId);

        // 2. Poll for task completion
        const pollInterval = 3000; // 3 seconds
        const maxWait = task.timeout || 1_800_000; // Default 30 minutes
        const startTime = Date.now();

        while (Date.now() - startTime < maxWait) {
          // Check if parent operation has been cancelled
          const currentOperation = context.get().operations[state.operationId];
          if (currentOperation?.status === 'cancelled') {
            log('[%s] Operation cancelled, stopping polling', taskLogId);

            // Send interrupt request to stop the server-side task
            try {
              await aiAgentService.interruptTask({ threadId: createResult.threadId });
              log('[%s] Sent interrupt request for cancelled task', taskLogId);
            } catch (err) {
              log('[%s] Failed to interrupt cancelled task: %O', taskLogId, err);
            }

            // Update the source tool message to cancelled state.
            await context
              .get()
              .optimisticUpdateMessageContent(
                resultMessageId,
                'Task was cancelled by user.',
                undefined,
                { operationId: state.operationId },
              );

            const updatedMessages = context.get().dbMessagesMap[context.messageKey] || [];
            return {
              events,
              newState: { ...state, messages: updatedMessages },
              nextContext: {
                payload: {
                  parentMessageId,
                  result: {
                    error: 'Operation cancelled',
                    success: false,
                    threadId: createResult.threadId,
                  },
                } as SubAgentResultPayload,
                phase: 'sub_agent_result',
                session: {
                  messageCount: updatedMessages.length,
                  sessionId: state.operationId,
                  status: 'running',
                  stepCount: state.stepCount + 1,
                },
              } as AgentRuntimeContext,
            };
          }

          const status = await aiAgentService.getSubAgentTaskStatus({
            threadId: createResult.threadId,
          });

          // Update taskDetail on the source tool message if available.
          if (status.taskDetail) {
            context.get().internal_dispatchMessage(
              {
                id: resultMessageId,
                type: 'updateMessage',
                value: { taskDetail: status.taskDetail },
              },
              { operationId: state.operationId },
            );
            log('[%s] Updated source tool message with taskDetail', taskLogId);
          }

          if (status.status === 'completed') {
            log('[%s] Task completed successfully', taskLogId);
            if (status.result) {
              await context
                .get()
                .optimisticUpdateMessageContent(resultMessageId, status.result, undefined, {
                  operationId: state.operationId,
                });
            }
            const updatedMessages = context.get().dbMessagesMap[context.messageKey] || [];
            return {
              events,
              newState: { ...state, messages: updatedMessages },
              nextContext: {
                payload: {
                  parentMessageId,
                  result: {
                    result: status.result,
                    success: true,
                    threadId: createResult.threadId,
                  },
                } as SubAgentResultPayload,
                phase: 'sub_agent_result',
                session: {
                  messageCount: updatedMessages.length,
                  sessionId: state.operationId,
                  status: 'running',
                  stepCount: state.stepCount + 1,
                },
              } as AgentRuntimeContext,
            };
          }

          if (status.status === 'failed') {
            // Extract error message (error is always a string in TaskStatusResult)
            const errorMessage = status.error || 'Unknown error';
            log('[%s] Task failed: %s', taskLogId, errorMessage);
            await context
              .get()
              .optimisticUpdateMessageContent(
                resultMessageId,
                `Task failed: ${errorMessage}`,
                undefined,
                { operationId: state.operationId },
              );
            const updatedMessages = context.get().dbMessagesMap[context.messageKey] || [];
            return {
              events,
              newState: { ...state, messages: updatedMessages },
              nextContext: {
                payload: {
                  parentMessageId,
                  result: {
                    error: status.error,
                    success: false,
                    threadId: createResult.threadId,
                  },
                } as SubAgentResultPayload,
                phase: 'sub_agent_result',
                session: {
                  messageCount: updatedMessages.length,
                  sessionId: state.operationId,
                  status: 'running',
                  stepCount: state.stepCount + 1,
                },
              } as AgentRuntimeContext,
            };
          }

          if (status.status === 'cancel') {
            log('[%s] Task was cancelled', taskLogId);
            // Note: Don't fail the operation here - it was cancelled intentionally
            // The source tool message update records the cancellation.
            await context
              .get()
              .optimisticUpdateMessageContent(resultMessageId, 'Task was cancelled', undefined, {
                operationId: state.operationId,
              });
            const updatedMessages = context.get().dbMessagesMap[context.messageKey] || [];
            return {
              events,
              newState: { ...state, messages: updatedMessages },
              nextContext: {
                payload: {
                  parentMessageId,
                  result: {
                    error: 'Task was cancelled',
                    success: false,
                    threadId: createResult.threadId,
                  },
                } as SubAgentResultPayload,
                phase: 'sub_agent_result',
                session: {
                  messageCount: updatedMessages.length,
                  sessionId: state.operationId,
                  status: 'running',
                  stepCount: state.stepCount + 1,
                },
              } as AgentRuntimeContext,
            };
          }

          // Still processing, wait and poll again
          await sleep(pollInterval);
        }

        // Timeout reached
        log('[%s] Task timeout after %dms', taskLogId, maxWait);

        // Try to interrupt the task that timed out
        try {
          await aiAgentService.interruptTask({ threadId: createResult.threadId });
          log('[%s] Sent interrupt request for timed out task', taskLogId);
        } catch (err) {
          log('[%s] Failed to interrupt timed out task: %O', taskLogId, err);
        }

        await context
          .get()
          .optimisticUpdateMessageContent(
            resultMessageId,
            `Task timeout after ${maxWait}ms`,
            undefined,
            { operationId: state.operationId },
          );

        const updatedMessages = context.get().dbMessagesMap[context.messageKey] || [];
        return {
          events,
          newState: { ...state, messages: updatedMessages },
          nextContext: {
            payload: {
              parentMessageId,
              result: {
                error: `Task timeout after ${maxWait}ms`,
                success: false,
                threadId: createResult.threadId,
              },
            } as SubAgentResultPayload,
            phase: 'sub_agent_result',
            session: {
              messageCount: updatedMessages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          } as AgentRuntimeContext,
        };
      } catch (error) {
        log('[%s] Error executing task: %O', taskLogId, error);
        return {
          events,
          newState: state,
          nextContext: {
            payload: {
              parentMessageId,
              result: {
                error: error instanceof Error ? error.message : 'Unknown error',
                success: false,
                threadId: '',
              },
            } as SubAgentResultPayload,
            phase: 'sub_agent_result',
            session: {
              messageCount: state.messages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          } as AgentRuntimeContext,
        };
      }
    },

    /**
     * exec_sub_agents executor
     * Dispatches one or more sub-agents in parallel
     *
     * Flow:
     * 1. Call execSubAgentTask API for each task
     * 2. Poll for sub-agent completion
     * 3. Update the source tool message once with aggregated results
     * 4. Return sub_agents_batch_result phase with all results
     */
    exec_sub_agents: async (instruction, state) => {
      const { parentMessageId, tasks } = (instruction as AgentInstructionExecSubAgents).payload;

      const events: AgentEvent[] = [];
      const sessionLogId = `${state.operationId}:${state.stepCount}`;

      log('[%s][exec_sub_agents] Starting execution of %d tasks', sessionLogId, tasks.length);

      // Get context from operation
      const opContext = getOperationContext();
      const { agentId, topicId } = opContext;

      if (!agentId || !topicId) {
        log('[%s][exec_sub_agents] No valid context, cannot execute tasks', sessionLogId);
        return {
          events,
          newState: state,
          nextContext: {
            payload: {
              parentMessageId,
              results: tasks.map(() => ({
                error: 'No valid context available',
                success: false,
                threadId: '',
              })),
            } as SubAgentsBatchResultPayload,
            phase: 'sub_agents_batch_result',
            session: {
              messageCount: state.messages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          } as AgentRuntimeContext,
        };
      }

      // Execute all tasks in parallel
      const results = await pMap(
        tasks,
        async (task, taskIndex) => {
          const taskLogId = `${sessionLogId}:task-${taskIndex}`;
          log('[%s] Starting task: %s', taskLogId, task.description);

          try {
            const resultMessageId = parentMessageId;

            // 1. Create and execute task on server
            log('[%s] Using server-side execution', taskLogId);
            const createResult = await aiAgentService.execSubAgentTask({
              agentId,
              instruction: task.instruction,
              parentMessageId: resultMessageId,
              title: task.description,
              topicId,
            });

            if (!createResult.success) {
              log('[%s] Failed to create task: %s', taskLogId, createResult.error);
              return {
                error: createResult.error,
                success: false,
                threadId: '',
              };
            }

            log('[%s] Task created with threadId: %s', taskLogId, createResult.threadId);

            // 2. Poll for task completion
            const pollInterval = 3000; // 3 seconds
            const maxWait = task.timeout || 1_800_000; // Default 30 minutes
            const startTime = Date.now();

            while (Date.now() - startTime < maxWait) {
              // Check if parent operation has been cancelled
              const currentOperation = context.get().operations[state.operationId];
              if (currentOperation?.status === 'cancelled') {
                log('[%s] Operation cancelled, stopping polling', taskLogId);

                // Send interrupt request to stop the server-side task
                try {
                  await aiAgentService.interruptTask({ threadId: createResult.threadId });
                  log('[%s] Sent interrupt request for cancelled task', taskLogId);
                } catch (err) {
                  log('[%s] Failed to interrupt cancelled task: %O', taskLogId, err);
                }

                return {
                  error: 'Operation cancelled',
                  success: false,
                  threadId: createResult.threadId,
                };
              }

              const status = await aiAgentService.getSubAgentTaskStatus({
                threadId: createResult.threadId,
              });

              // Update taskDetail on the source tool message if available.
              if (status.taskDetail) {
                context.get().internal_dispatchMessage(
                  {
                    id: resultMessageId,
                    type: 'updateMessage',
                    value: { taskDetail: status.taskDetail },
                  },
                  { operationId: state.operationId },
                );
                log('[%s] Updated source tool message with taskDetail', taskLogId);
              }

              if (status.status === 'completed') {
                log('[%s] Task completed successfully', taskLogId);
                return {
                  result: status.result,
                  success: true,
                  threadId: createResult.threadId,
                };
              }

              if (status.status === 'failed') {
                const errorMessage = status.error || 'Unknown error';
                log('[%s] Task failed: %s', taskLogId, errorMessage);
                return {
                  error: status.error,
                  success: false,
                  threadId: createResult.threadId,
                };
              }

              if (status.status === 'cancel') {
                log('[%s] Task was cancelled', taskLogId);
                // Note: Don't fail the operation here - it was cancelled intentionally
                // The aggregate result update below records the cancellation.
                return {
                  error: 'Task was cancelled',
                  success: false,
                  threadId: createResult.threadId,
                };
              }

              // Still processing, wait and poll again
              await sleep(pollInterval);
            }

            // Timeout reached
            log('[%s] Task timeout after %dms', taskLogId, maxWait);

            // Try to interrupt the task that timed out
            try {
              await aiAgentService.interruptTask({ threadId: createResult.threadId });
              log('[%s] Sent interrupt request for timed out task', taskLogId);
            } catch (err) {
              log('[%s] Failed to interrupt timed out task: %O', taskLogId, err);
            }

            return {
              error: `Task timeout after ${maxWait}ms`,
              success: false,
              threadId: createResult.threadId,
            };
          } catch (error) {
            log('[%s] Error executing task: %O', taskLogId, error);
            return {
              error: error instanceof Error ? error.message : 'Unknown error',
              success: false,
              threadId: '',
            };
          }
        },
        { concurrency: 15 }, // Limit concurrent tasks
      );

      log('[%s][exec_sub_agents] All tasks completed, results: %O', sessionLogId, results);

      await context
        .get()
        .optimisticUpdateMessageContent(
          parentMessageId,
          formatSubAgentBatchResultContent(tasks, results),
          undefined,
          { operationId: state.operationId },
        );

      // Get latest messages from store
      const updatedMessages = context.get().dbMessagesMap[context.messageKey] || [];
      const newState = { ...state, messages: updatedMessages };

      // Return sub_agents_batch_result phase
      return {
        events,
        newState,
        nextContext: {
          payload: {
            parentMessageId,
            results,
          } as SubAgentsBatchResultPayload,
          phase: 'sub_agents_batch_result',
          session: {
            messageCount: newState.messages.length,
            sessionId: state.operationId,
            status: 'running',
            stepCount: state.stepCount + 1,
          },
        } as AgentRuntimeContext,
      };
    },

    /**
     * Context compression executor
     * Compresses ALL messages into a single MessageGroup summary to reduce token usage
     */
    compress_context: async (instruction, state) => {
      const sessionLogId = `${state.operationId}:${state.stepCount}`;
      const stagePrefix = `[${sessionLogId}][compress_context]`;

      const { messages, currentTokenCount } = (instruction as AgentInstructionCompressContext)
        .payload;

      // Get topicId from operation context (same as agentId)
      const { topicId } = getOperationContext();

      log(
        `${stagePrefix} Starting compression. displayMessages=%d, tokens=%d`,
        messages.length,
        currentTokenCount,
      );

      const events: AgentEvent[] = [];

      // Get message IDs from dbMessagesMap (raw db messages)
      const dbMessages = context.get().dbMessagesMap[context.messageKey] || [];
      const messageIds = getCompressionCandidateMessageIds(dbMessages);

      if (!topicId || messageIds.length === 0) {
        // No topicId or no messages, skip compression
        log(
          `${stagePrefix} Skipping compression: topicId=%s, messageIds=%d`,
          topicId,
          messageIds.length,
        );
        return {
          events: [],
          newState: state,
          nextContext: {
            payload: {
              compressedMessages: messages,
              compressedTokenCount: currentTokenCount,
              groupId: '',
              originalTokenCount: currentTokenCount,
              skipped: true,
            } as GeneralAgentCompressionResultPayload,
            phase: 'compression_result',
            session: {
              messageCount: state.messages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          } as AgentRuntimeContext,
        };
      }

      // Find the latest assistant message to attach the compression operation
      const latestAssistantMessage = dbMessages.findLast((m) => m.role === 'assistant');
      const assistantMessageId = latestAssistantMessage?.id;

      log(
        `${stagePrefix} Compressing %d db messages (display: %d), assistantMsgId=%s`,
        messageIds.length,
        messages.length,
        assistantMessageId,
      );

      // Create compress_context operation and attach to the assistant message
      const { operationId: compressOperationId } = context.get().startOperation({
        context: { ...getOperationContext(), messageId: assistantMessageId },
        metadata: {
          messageCount: messageIds.length,
          startTime: Date.now(),
        },
        parentOperationId: state.operationId,
        type: 'contextCompression',
      });

      try {
        const opContext = getOperationContext();
        // agentId is guaranteed to exist in compression context
        const agentId = getEffectiveAgentId()!;

        // 1. Create compression group with placeholder content
        const result = await messageService.createCompressionGroup({
          agentId,
          messageIds,
          topicId,
        });
        const { messageGroupId, messages: initialCompressedMessages, messagesToSummarize } = result;

        // 2. Update UI with compressed messages immediately
        context.get().replaceMessages(initialCompressedMessages, { context: opContext });

        // 3. Get model/provider from compressionModel config
        const { model, provider } = state.modelRuntimeConfig?.compressionModel || {};

        log(
          `${stagePrefix} Created group=%s, generating summary for %d messages by %s`,
          messageGroupId,
          messagesToSummarize.length,
          `${provider}/${model}`,
        );

        // 4. Build compression prompt and generate summary with streaming UI updates
        const compressionPayload = chainCompressContext(messagesToSummarize);
        let summaryContent = '';

        // Start generateSummary operation attached to the compressed group message
        const { abortController: summaryAbortController, operationId: summaryOperationId } = context
          .get()
          .startOperation({
            context: { ...getOperationContext(), messageId: messageGroupId },
            type: 'generateSummary',
            parentOperationId: compressOperationId,
          });

        await chatService.fetchPresetTaskResult({
          abortController: summaryAbortController,
          params: { ...compressionPayload, model, provider },
          onMessageHandle: (chunk) => {
            if (chunk.type === 'text') {
              summaryContent += chunk.text || '';
              // Stream update the compression group message content
              context
                .get()
                .internal_dispatchMessage(
                  { id: messageGroupId, type: 'updateMessage', value: { content: summaryContent } },
                  { operationId: summaryOperationId },
                );
            }
          },
          onError: (e) => {
            console.error(e);
            context.get().completeOperation(summaryOperationId, {
              error: { message: String(e), type: 'summary_generation_failed' },
            });
          },
        });

        if (summaryAbortController.signal.aborted) throw createAbortError();

        log(`${stagePrefix} Generated summary: %d chars`, summaryContent.length);

        // 5. Finalize compression with actual content
        const finalResult = await messageService.finalizeCompression({
          agentId,
          content: summaryContent,
          messageGroupId,
          topicId,
        });
        // Complete the generateSummary operation
        context.get().completeOperation(summaryOperationId);

        const compressedMessages = finalResult.messages || initialCompressedMessages;
        const groupId = messageGroupId;
        // Use the latest assistant message ID (before compression) as parentMessageId for next call_llm
        const parentMessageId = assistantMessageId;

        // 6. Update UI with finalized messages (includes compressedGroup with summary)
        context.get().replaceMessages(compressedMessages, { context: opContext });

        log(
          `${stagePrefix} Compression complete. groupId=%s, parentMessageId=%s`,
          groupId,
          parentMessageId,
        );

        // Complete the compress_context operation
        context.get().completeOperation(compressOperationId, { groupId, parentMessageId });

        events.push({ type: 'compression_complete', groupId, parentMessageId });

        // Calculate new token count
        const compressedTokenCount = countContextTokens({
          messages: compressedMessages,
        }).rawTotal;

        return {
          events,
          newState: { ...state, messages: compressedMessages },
          nextContext: {
            payload: {
              compressedMessages,
              compressedTokenCount,
              groupId,
              originalTokenCount: currentTokenCount,
              parentMessageId,
            } as GeneralAgentCompressionResultPayload,
            phase: 'compression_result',
            session: {
              messageCount: compressedMessages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          } as AgentRuntimeContext,
        };
      } catch (error) {
        if (isAbortError(error)) {
          log(`${stagePrefix} Compression cancelled`);

          if (context.get().operations[compressOperationId]?.status === 'running') {
            context.get().completeOperation(compressOperationId, { cancelled: true });
          }

          events.push({ type: 'compression_error', error });

          return {
            events,
            newState: state,
            nextContext: {
              payload: {
                compressedMessages: messages,
                skipped: true,
              } as GeneralAgentCompressionResultPayload,
              phase: 'compression_result',
              session: {
                messageCount: state.messages.length,
                sessionId: state.operationId,
                status: 'running',
                stepCount: state.stepCount + 1,
              },
            } as AgentRuntimeContext,
          };
        }

        log(`${stagePrefix} Compression failed: %O`, error);

        // Complete the compress_context operation with error
        context.get().completeOperation(compressOperationId, {
          error: {
            message: error instanceof Error ? error.message : String(error),
            type: 'compression_failed',
          },
        });

        // On error, continue without compression
        events.push({ type: 'compression_error', error });

        return {
          events,
          newState: state,
          nextContext: {
            payload: {
              compressedMessages: messages,
              skipped: true,
            } as GeneralAgentCompressionResultPayload,
            phase: 'compression_result',
            session: {
              messageCount: state.messages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          } as AgentRuntimeContext,
        };
      }
    },
  };

  return executors;
};
