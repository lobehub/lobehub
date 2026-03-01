import type { ChatTopicBotContext } from '@lobechat/types';
import type { Message, SentMessage, Thread } from 'chat';
import { emoji } from 'chat';
import debug from 'debug';
import urlJoin from 'url-join';

import { getServerDB } from '@/database/core/db-adaptor';
import { appEnv } from '@/envs/app';
import { AiAgentService } from '@/server/services/aiAgent';
import { isQueueAgentRuntimeEnabled } from '@/server/services/queue/impls';

import {
  renderError,
  renderFinalReply,
  renderStart,
  renderStepProgress,
  splitMessage,
} from './replyTemplate';

const log = debug('lobe-server:bot:agent-bridge');

const EXECUTION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

// Status emoji added on receive, removed on complete
const RECEIVED_EMOJI = emoji.eyes;

/**
 * Extract a human-readable error message from agent runtime error objects.
 * Handles various shapes: string, { message }, { errorType, error: { stack } }, etc.
 */
function extractErrorMessage(err: unknown): string {
  if (!err) return 'Agent execution failed';
  if (typeof err === 'string') return err;

  const e = err as Record<string, any>;

  // { message: '...' }
  if (typeof e.message === 'string') return e.message;

  // { errorType: 'ProviderBizError', error: { stack: 'Error: ...\n  at ...' } }
  if (e.error?.stack) {
    const firstLine = String(e.error.stack).split('\n')[0];
    const prefix = e.errorType ? `[${e.errorType}] ` : '';
    return `${prefix}${firstLine}`;
  }

  // { body: { message: '...' } }
  if (typeof e.body?.message === 'string') return e.body.message;

  return JSON.stringify(err);
}

/**
 * Fire-and-forget wrapper for reaction operations.
 * Reactions should never block or fail the main flow.
 */
async function safeReaction(fn: () => Promise<void>, label: string): Promise<void> {
  try {
    await fn();
  } catch (error) {
    log('safeReaction [%s] failed: %O', label, error);
  }
}

interface BridgeHandlerOpts {
  agentId: string;
  botContext?: ChatTopicBotContext;
  userId: string;
}

/**
 * Platform-agnostic bridge between Chat SDK events and Agent Runtime.
 *
 * Uses in-process onComplete callback to get agent execution results.
 * Provides real-time feedback via emoji reactions and editable progress messages.
 */
export class AgentBridgeService {
  /**
   * Handle a new @mention — start a fresh conversation.
   */
  async handleMention(
    thread: Thread<{ topicId?: string }>,
    message: Message,
    opts: BridgeHandlerOpts,
  ): Promise<void> {
    const { agentId, botContext, userId } = opts;

    log('handleMention: agentId=%s, user=%s, text=%s', agentId, userId, message.text.slice(0, 80));

    // Immediate feedback: mark as received + show typing
    await safeReaction(
      () => thread.adapter.addReaction(thread.id, message.id, RECEIVED_EMOJI),
      'add eyes',
    );
    await thread.subscribe();
    await thread.startTyping();

    try {
      // executeWithCallback handles progress message (post + edit at each step)
      // The final reply is edited into the progress message by onComplete
      const { topicId } = await this.executeWithCallback(thread, message, {
        agentId,
        botContext,
        trigger: 'bot',
        userId,
      });

      // Persist topic mapping in thread state for follow-up messages
      if (topicId) {
        await thread.setState({ topicId });
        log('handleMention: stored topicId=%s in thread=%s state', topicId, thread.id);
      }
    } catch (error) {
      log('handleMention error: %O', error);
      const msg = error instanceof Error ? error.message : String(error);
      await thread.post(`**Agent Execution Failed**\n\`\`\`\n${msg}\n\`\`\``);
    } finally {
      // Always clean up reactions
      await this.removeReceivedReaction(thread, message);
    }
  }

  /**
   * Handle a follow-up message inside a subscribed thread — multi-turn conversation.
   */
  async handleSubscribedMessage(
    thread: Thread<{ topicId?: string }>,
    message: Message,
    opts: BridgeHandlerOpts,
  ): Promise<void> {
    const { agentId, botContext, userId } = opts;
    const threadState = await thread.state;
    const topicId = threadState?.topicId;

    log('handleSubscribedMessage: agentId=%s, thread=%s, topicId=%s', agentId, thread.id, topicId);

    if (!topicId) {
      log('handleSubscribedMessage: no topicId in thread state, treating as new mention');
      return this.handleMention(thread, message, { agentId, botContext, userId });
    }

    // Immediate feedback: mark as received + show typing
    await safeReaction(
      () => thread.adapter.addReaction(thread.id, message.id, RECEIVED_EMOJI),
      'add eyes',
    );
    await thread.startTyping();

    try {
      // executeWithCallback handles progress message (post + edit at each step)
      await this.executeWithCallback(thread, message, {
        agentId,
        botContext,
        topicId,
        trigger: 'bot',
        userId,
      });
    } catch (error) {
      log('handleSubscribedMessage error: %O', error);
      const msg = error instanceof Error ? error.message : String(error);
      await thread.post(`**Agent Execution Failed**. Details:\n\`\`\`\n${msg}\n\`\`\``);
    } finally {
      await this.removeReceivedReaction(thread, message);
    }
  }

  /**
   * Dispatch to queue-mode webhooks or local in-memory callbacks based on runtime mode.
   */
  private async executeWithCallback(
    thread: Thread<{ topicId?: string }>,
    userMessage: Message,
    opts: {
      agentId: string;
      botContext?: ChatTopicBotContext;
      topicId?: string;
      trigger?: string;
      userId: string;
    },
  ): Promise<{ reply: string; topicId: string }> {
    if (isQueueAgentRuntimeEnabled()) {
      return this.executeWithWebhooks(thread, userMessage, opts);
    }
    return this.executeWithInMemoryCallbacks(thread, userMessage, opts);
  }

  /**
   * Queue mode: post initial message, configure step/completion webhooks,
   * then return immediately. Progress updates and final reply are handled
   * by the bot-callback webhook endpoint.
   */
  private async executeWithWebhooks(
    thread: Thread<{ topicId?: string }>,
    userMessage: Message,
    opts: {
      agentId: string;
      botContext?: ChatTopicBotContext;
      topicId?: string;
      trigger?: string;
      userId: string;
    },
  ): Promise<{ reply: string; topicId: string }> {
    const { agentId, botContext, userId, topicId, trigger } = opts;

    const serverDB = await getServerDB();
    const aiAgentService = new AiAgentService(serverDB, userId);

    // Post initial progress message to get the message ID
    let progressMessage: SentMessage | undefined;
    try {
      progressMessage = await thread.post(renderStart(userMessage.text));
    } catch (error) {
      log('executeWithWebhooks: failed to post progress message: %O', error);
    }

    const progressMessageId = progressMessage?.id;
    if (!progressMessageId) {
      throw new Error('Failed to post initial progress message');
    }

    // Build webhook URL for bot-callback endpoint
    // Prefer INTERNAL_APP_URL for server-to-server calls (bypasses CDN/proxy)
    const baseURL = appEnv.INTERNAL_APP_URL || appEnv.APP_URL;
    if (!baseURL) {
      throw new Error('APP_URL is required for queue mode bot webhooks');
    }
    const callbackUrl = urlJoin(baseURL, '/api/agent/webhooks/bot-callback');

    // Shared webhook body with bot context
    const webhookBody = {
      applicationId: botContext?.applicationId,
      platformThreadId: botContext?.platformThreadId,
      progressMessageId,
    };

    log(
      'executeWithWebhooks: agentId=%s, callbackUrl=%s, progressMessageId=%s',
      agentId,
      callbackUrl,
      progressMessageId,
    );

    const result = await aiAgentService.execAgent({
      agentId,
      appContext: topicId ? { topicId } : undefined,
      autoStart: true,
      botContext,
      completionWebhook: { body: webhookBody, url: callbackUrl },
      prompt: userMessage.text,
      stepWebhook: { body: webhookBody, url: callbackUrl },
      trigger,
      userInterventionConfig: { approvalMode: 'headless' },
      webhookDelivery: 'qstash',
    });

    log(
      'executeWithWebhooks: operationId=%s, topicId=%s (webhook mode, returning immediately)',
      result.operationId,
      result.topicId,
    );

    // Return immediately — progress/completion handled by webhooks
    return { reply: '', topicId: result.topicId };
  }

  /**
   * Local mode: use in-memory step callbacks and wait for completion via Promise.
   */
  private async executeWithInMemoryCallbacks(
    thread: Thread<{ topicId?: string }>,
    userMessage: Message,
    opts: {
      agentId: string;
      botContext?: ChatTopicBotContext;
      topicId?: string;
      trigger?: string;
      userId: string;
    },
  ): Promise<{ reply: string; topicId: string }> {
    const { agentId, botContext, userId, topicId, trigger } = opts;

    const serverDB = await getServerDB();
    const aiAgentService = new AiAgentService(serverDB, userId);

    // Post initial progress message
    let progressMessage: SentMessage | undefined;
    try {
      progressMessage = await thread.post(renderStart(userMessage.text));
    } catch (error) {
      log('executeWithInMemoryCallbacks: failed to post progress message: %O', error);
    }

    // Track the last LLM content and tool calls for showing during tool execution
    let lastLLMContent = '';
    let lastToolsCalling:
      | Array<{ apiName: string; arguments?: string; identifier: string }>
      | undefined;
    let totalToolCalls = 0;
    let operationStartTime = 0;

    return new Promise<{ reply: string; topicId: string }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Agent execution timed out`));
      }, EXECUTION_TIMEOUT);

      let assistantMessageId: string;
      let resolvedTopicId: string;

      const getElapsedMs = () => (operationStartTime > 0 ? Date.now() - operationStartTime : 0);

      aiAgentService
        .execAgent({
          agentId,
          appContext: topicId ? { topicId } : undefined,
          autoStart: true,
          botContext,
          prompt: userMessage.text,
          stepCallbacks: {
            onAfterStep: async (stepData) => {
              const { content, shouldContinue, toolsCalling } = stepData;
              if (!shouldContinue || !progressMessage) return;

              if (toolsCalling) totalToolCalls += toolsCalling.length;

              const progressText = renderStepProgress({
                ...stepData,
                elapsedMs: getElapsedMs(),
                lastContent: lastLLMContent,
                lastToolsCalling,
                totalToolCalls,
              });

              if (content) lastLLMContent = content;
              if (toolsCalling) lastToolsCalling = toolsCalling;

              try {
                progressMessage = await progressMessage.edit(progressText);
              } catch (error) {
                log('executeWithInMemoryCallbacks: failed to edit progress message: %O', error);
              }
            },

            onComplete: async ({ finalState, reason }) => {
              clearTimeout(timeout);

              log('onComplete: reason=%s, assistantMessageId=%s', reason, assistantMessageId);

              if (reason === 'error') {
                const errorMsg = extractErrorMessage(finalState.error);
                if (progressMessage) {
                  try {
                    await progressMessage.edit(renderError(errorMsg));
                  } catch {
                    // ignore edit failure
                  }
                }
                reject(new Error(errorMsg));
                return;
              }

              try {
                // Extract reply from finalState.messages (accumulated across all steps)
                const lastAssistantContent = finalState.messages
                  ?.slice()
                  .reverse()
                  .find(
                    (m: { content?: string; role: string }) => m.role === 'assistant' && m.content,
                  )?.content;

                if (lastAssistantContent) {
                  const finalText = renderFinalReply(lastAssistantContent, {
                    elapsedMs: getElapsedMs(),
                    llmCalls: finalState.usage?.llm?.apiCalls ?? 0,
                    toolCalls: finalState.usage?.tools?.totalCalls ?? 0,
                    totalCost: finalState.cost?.total ?? 0,
                    totalTokens: finalState.usage?.llm?.tokens?.total ?? 0,
                  });

                  const chunks = splitMessage(finalText);

                  if (progressMessage) {
                    try {
                      await progressMessage.edit(chunks[0]);
                      // Post overflow chunks as follow-up messages
                      for (let i = 1; i < chunks.length; i++) {
                        await thread.post(chunks[i]);
                      }
                    } catch (error) {
                      log(
                        'executeWithInMemoryCallbacks: failed to edit final progress message: %O',
                        error,
                      );
                    }
                  }

                  log(
                    'executeWithInMemoryCallbacks: got response from finalState (%d chars, %d chunks)',
                    lastAssistantContent.length,
                    chunks.length,
                  );
                  resolve({ reply: lastAssistantContent, topicId: resolvedTopicId });
                  return;
                }

                reject(new Error('Agent completed but no response content found'));
              } catch (error) {
                reject(error);
              }
            },
          },
          trigger,
          userInterventionConfig: { approvalMode: 'headless' },
        })
        .then((result) => {
          assistantMessageId = result.assistantMessageId;
          resolvedTopicId = result.topicId;
          operationStartTime = new Date(result.createdAt).getTime();

          log(
            'executeWithInMemoryCallbacks: operationId=%s, assistantMessageId=%s, topicId=%s',
            result.operationId,
            result.assistantMessageId,
            result.topicId,
          );
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  /**
   * Remove the received reaction from a user message (fire-and-forget).
   */
  private async removeReceivedReaction(
    thread: Thread<{ topicId?: string }>,
    message: Message,
  ): Promise<void> {
    await safeReaction(
      () => thread.adapter.removeReaction(thread.id, message.id, RECEIVED_EMOJI),
      'remove eyes',
    );
  }
}
