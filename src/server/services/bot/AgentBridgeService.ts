import type { ChatTopicBotContext } from '@lobechat/types';
import type { Message, SentMessage, Thread } from 'chat';
import { emoji } from 'chat';
import debug from 'debug';
import urlJoin from 'url-join';

import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { AiAgentService } from '@/server/services/aiAgent';
import { isQueueAgentRuntimeEnabled } from '@/server/services/queue/impls';
import { SystemAgentService } from '@/server/services/systemAgent';

import { formatPrompt as formatPromptUtil } from './formatPrompt';
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

/**
 * Extract the parent channel thread ID for reacting to the original mention message.
 * In Discord, when a thread is created on a message, that message still belongs to
 * the parent channel. To add/remove reactions on it, we need to use the parent channel ID.
 *
 * e.g. "discord:guild:parentChannel:thread" → "discord:guild:parentChannel"
 */
function parentChannelThreadId(threadId: string): string {
  const parts = threadId.split(':');
  if (parts.length >= 4 && parts[0] === 'discord') {
    return `discord:${parts[1]}:${parts[2]}`;
  }
  return threadId;
}

interface DiscordChannelContext {
  channel: { id: string; name?: string; topic?: string; type?: number };
  guild: { id: string };
}

interface ThreadState {
  channelContext?: DiscordChannelContext;
  topicId?: string;
}

interface BridgeHandlerOpts {
  agentId: string;
  botContext?: ChatTopicBotContext;
}

/**
 * Platform-agnostic bridge between Chat SDK events and Agent Runtime.
 *
 * Each instance is bound to a specific (serverDB, userId) pair,
 * following the same pattern as other server services (AiAgentService, UserModel, etc.).
 *
 * Provides real-time feedback via emoji reactions and editable progress messages.
 */
export class AgentBridgeService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;

  private timezone: string | undefined;
  private timezoneLoaded = false;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  /**
   * Handle a new @mention — start a fresh conversation.
   */
  async handleMention(
    thread: Thread<ThreadState>,
    message: Message,
    opts: BridgeHandlerOpts,
  ): Promise<void> {
    const { agentId, botContext } = opts;

    log(
      'handleMention: agentId=%s, user=%s, text=%s',
      agentId,
      this.userId,
      message.text.slice(0, 80),
    );

    // Immediate feedback: mark as received + show typing
    // The mention message lives in the parent channel (not the thread), so we strip
    // the thread segment from the ID to target the parent channel for reactions.
    await safeReaction(
      () =>
        thread.adapter.addReaction(parentChannelThreadId(thread.id), message.id, RECEIVED_EMOJI),
      'add eyes',
    );
    await thread.subscribe();
    await thread.startTyping();

    // Keep typing indicator alive (Telegram's expires after ~5s)
    const typingInterval = setInterval(() => {
      thread.startTyping().catch(() => {});
    }, 4000);

    // Fetch channel context for Discord context injection
    const channelContext = await this.fetchChannelContext(thread);

    const queueMode = isQueueAgentRuntimeEnabled();

    try {
      // executeWithCallback handles progress message (post + edit at each step)
      // The final reply is edited into the progress message by onComplete
      const { topicId } = await this.executeWithCallback(thread, message, {
        agentId,
        botContext,
        channelContext,
        reactionThreadId: parentChannelThreadId(thread.id),
        trigger: 'bot',
      });

      // Persist topic mapping and channel context in thread state for follow-up messages
      if (topicId) {
        await thread.setState({ channelContext, topicId });
        log('handleMention: stored topicId=%s in thread=%s state', topicId, thread.id);
      }
    } catch (error) {
      log('handleMention error: %O', error);
      const msg = error instanceof Error ? error.message : String(error);
      await thread.post(`**Agent Execution Failed**\n\`\`\`\n${msg}\n\`\`\``);
    } finally {
      clearInterval(typingInterval);
      // In queue mode, reaction is removed by the bot-callback webhook on completion
      if (!queueMode) {
        // Mention message is in parent channel
        await this.removeReceivedReaction(thread, message, parentChannelThreadId(thread.id));
      }
    }
  }

  /**
   * Handle a follow-up message inside a subscribed thread — multi-turn conversation.
   */
  async handleSubscribedMessage(
    thread: Thread<ThreadState>,
    message: Message,
    opts: BridgeHandlerOpts,
  ): Promise<void> {
    const { agentId, botContext } = opts;
    const threadState = await thread.state;
    const topicId = threadState?.topicId;

    log('handleSubscribedMessage: agentId=%s, thread=%s, topicId=%s', agentId, thread.id, topicId);

    if (!topicId) {
      log('handleSubscribedMessage: no topicId in thread state, treating as new mention');
      return this.handleMention(thread, message, { agentId, botContext });
    }

    // Read cached channel context from thread state
    const channelContext = threadState?.channelContext;

    const queueMode = isQueueAgentRuntimeEnabled();

    // Immediate feedback: mark as received + show typing
    // Subscribed messages are inside the thread, so pass thread.id directly
    await safeReaction(
      () => thread.adapter.addReaction(thread.id, message.id, RECEIVED_EMOJI),
      'add eyes',
    );
    await thread.startTyping();

    // Keep typing indicator alive (Telegram's expires after ~5s)
    const typingInterval = setInterval(() => {
      thread.startTyping().catch(() => {});
    }, 4000);

    try {
      // executeWithCallback handles progress message (post + edit at each step)
      await this.executeWithCallback(thread, message, {
        agentId,
        botContext,
        channelContext,
        topicId,
        trigger: 'bot',
      });
    } catch (error) {
      // If the cached topicId references a deleted topic (FK violation),
      // clear thread state and retry as a fresh mention instead of surfacing the DB error.
      const errMsg = error instanceof Error ? error.message : String(error);
      if (errMsg.includes('Failed query') && errMsg.includes('topic_id')) {
        log(
          'handleSubscribedMessage: stale topicId=%s, resetting and retrying as new mention',
          topicId,
        );
        await thread.setState({ ...threadState, topicId: undefined });
        return this.handleMention(thread, message, { agentId, botContext });
      }

      log('handleSubscribedMessage error: %O', error);
      await thread.post(`**Agent Execution Failed**. Details:\n\`\`\`\n${errMsg}\n\`\`\``);
    } finally {
      clearInterval(typingInterval);
      // In queue mode, reaction is removed by the bot-callback webhook on completion
      if (!queueMode) {
        await this.removeReceivedReaction(thread, message);
      }
    }
  }

  /**
   * Dispatch to queue-mode webhooks or local in-memory callbacks based on runtime mode.
   */
  private async executeWithCallback(
    thread: Thread<ThreadState>,
    userMessage: Message,
    opts: {
      agentId: string;
      botContext?: ChatTopicBotContext;
      channelContext?: DiscordChannelContext;
      /** Thread ID to use for removing the user message reaction in queue mode */
      reactionThreadId?: string;
      topicId?: string;
      trigger?: string;
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
    thread: Thread<ThreadState>,
    userMessage: Message,
    opts: {
      agentId: string;
      botContext?: ChatTopicBotContext;
      channelContext?: DiscordChannelContext;
      reactionThreadId?: string;
      topicId?: string;
      trigger?: string;
    },
  ): Promise<{ reply: string; topicId: string }> {
    const { agentId, botContext, channelContext, reactionThreadId, topicId, trigger } = opts;

    const aiAgentService = new AiAgentService(this.db, this.userId);
    const timezone = await this.loadTimezone();

    // Post initial progress message to get the message ID
    let progressMessage: SentMessage | undefined;
    try {
      progressMessage = await thread.post(renderStart(userMessage.text, { timezone }));
    } catch (error) {
      log('executeWithWebhooks: failed to post progress message: %O', error);
    }

    const progressMessageId = progressMessage?.id;
    if (!progressMessageId) {
      throw new Error('Failed to post initial progress message');
    }

    // Refresh typing indicator after posting the ack message,
    // so typing stays active until the first step webhook arrives
    await thread.startTyping();

    // Build webhook URL for bot-callback endpoint
    // Prefer INTERNAL_APP_URL for server-to-server calls (bypasses CDN/proxy)
    const baseURL = appEnv.INTERNAL_APP_URL || appEnv.APP_URL;
    if (!baseURL) {
      throw new Error('APP_URL is required for queue mode bot webhooks');
    }
    const callbackUrl = urlJoin(baseURL, '/api/agent/webhooks/bot-callback');

    // Shared webhook body with bot context
    // reactionChannelId: the Discord channel where the user message lives (for reaction removal).
    // For mention messages this is the parent channel; for thread messages it's the thread itself.
    const reactionChannelId = reactionThreadId ? reactionThreadId.split(':')[2] : undefined;
    const webhookBody = {
      applicationId: botContext?.applicationId,
      platformThreadId: botContext?.platformThreadId,
      progressMessageId,
      reactionChannelId,
      userMessageId: userMessage.id,
    };

    const files = this.extractFiles(userMessage);
    const prompt = this.formatPrompt(userMessage, botContext);

    log(
      'executeWithWebhooks: agentId=%s, callbackUrl=%s, progressMessageId=%s, prompt=%s, files=%d',
      agentId,
      callbackUrl,
      progressMessageId,
      prompt.slice(0, 100),
      files?.length ?? 0,
    );

    const result = await aiAgentService.execAgent({
      agentId,
      appContext: topicId ? { topicId } : undefined,
      autoStart: true,
      botContext,
      completionWebhook: { body: webhookBody, url: callbackUrl },
      discordContext: channelContext
        ? { channel: channelContext.channel, guild: channelContext.guild }
        : undefined,
      files,
      prompt,
      stepWebhook: { body: webhookBody, url: callbackUrl },
      title: '',
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
    thread: Thread<ThreadState>,
    userMessage: Message,
    opts: {
      agentId: string;
      botContext?: ChatTopicBotContext;
      channelContext?: DiscordChannelContext;
      topicId?: string;
      trigger?: string;
    },
  ): Promise<{ reply: string; topicId: string }> {
    const { agentId, botContext, channelContext, topicId, trigger } = opts;

    const aiAgentService = new AiAgentService(this.db, this.userId);
    const timezone = await this.loadTimezone();

    // Post initial progress message
    let progressMessage: SentMessage | undefined;
    try {
      progressMessage = await thread.post(renderStart(userMessage.text, { timezone }));
    } catch (error) {
      log('executeWithInMemoryCallbacks: failed to post progress message: %O', error);
    }

    const platform = botContext?.platform;

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

      const files = this.extractFiles(userMessage);
      const prompt = this.formatPrompt(userMessage, botContext);

      log(
        'executeWithInMemoryCallbacks: agentId=%s, prompt=%s, files=%d',
        agentId,
        prompt.slice(0, 100),
        files?.length ?? 0,
      );

      aiAgentService
        .execAgent({
          agentId,
          appContext: topicId ? { topicId } : undefined,
          autoStart: true,
          botContext,
          discordContext: channelContext
            ? { channel: channelContext.channel, guild: channelContext.guild }
            : undefined,
          files,
          prompt,
          title: '',
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
                platform,
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
                    platform,
                    toolCalls: finalState.usage?.tools?.totalCalls ?? 0,
                    totalCost: finalState.cost?.total ?? 0,
                    totalTokens: finalState.usage?.llm?.tokens?.total ?? 0,
                  });

                  // Telegram supports 4096 chars vs Discord's 2000
                  const charLimit = platform === 'telegram' ? 4000 : undefined;
                  const chunks = splitMessage(finalText, charLimit);

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

                  // Fire-and-forget: summarize topic title in DB (no Discord rename in local mode)
                  if (resolvedTopicId && prompt) {
                    const topicModel = new TopicModel(this.db, this.userId);
                    topicModel
                      .findById(resolvedTopicId)
                      .then(async (topic) => {
                        if (topic?.title) return;

                        const systemAgent = new SystemAgentService(this.db, this.userId);
                        const title = await systemAgent.generateTopicTitle({
                          lastAssistantContent,
                          userPrompt: prompt,
                        });
                        if (!title) return;

                        await topicModel.update(resolvedTopicId, { title });
                      })
                      .catch((error) => {
                        log(
                          'executeWithInMemoryCallbacks: topic title summarization failed: %O',
                          error,
                        );
                      });
                  }

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
   * Fetch channel context from the Chat SDK adapter.
   * Uses fetchThread to get channel name, and decodeThreadId to extract guild/channel IDs.
   */
  private async fetchChannelContext(
    thread: Thread<ThreadState>,
  ): Promise<DiscordChannelContext | undefined> {
    try {
      // Decode thread ID to get guild and channel IDs
      // Discord format: "discord:guildId:channelId[:threadId]"
      const decoded = thread.adapter.decodeThreadId(thread.id) as {
        channelId?: string;
        guildId?: string;
      };

      if (!decoded?.guildId || !decoded?.channelId) {
        log('fetchChannelContext: could not decode guildId/channelId from thread %s', thread.id);
        return undefined;
      }

      // Fetch thread info to get channel name and metadata
      const threadInfo = await thread.adapter.fetchThread(thread.id);
      const raw = threadInfo.metadata?.raw as { topic?: string; type?: number } | undefined;

      const context: DiscordChannelContext = {
        channel: {
          id: decoded.channelId,
          name: threadInfo.channelName,
          topic: raw?.topic,
          type: raw?.type,
        },
        guild: { id: decoded.guildId },
      };

      log(
        'fetchChannelContext: guild=%s, channel=%s (%s)',
        decoded.guildId,
        decoded.channelId,
        threadInfo.channelName,
      );

      return context;
    } catch (error) {
      log('fetchChannelContext: failed to fetch channel context: %O', error);
      return undefined;
    }
  }

  /**
   * Extract file attachment metadata from Chat SDK message for passing to execAgent.
   * Includes attachments from both the message itself and any referenced (quoted) message.
   */
  private extractFiles(
    message: Message,
  ): Array<{ mimeType?: string; name?: string; size?: number; url: string }> | undefined {
    type AttachmentLike = {
      content_type?: string;
      filename?: string;
      mimeType?: string;
      name?: string;
      size?: number;
      type?: string;
      url?: string;
    };

    const files: Array<{ mimeType?: string; name?: string; size?: number; url: string }> = [];

    // 1. Direct attachments from the message (parsed by Chat SDK)
    const directAttachments = (message as any).attachments as AttachmentLike[] | undefined;
    if (directAttachments?.length) {
      for (const att of directAttachments) {
        if (att.url) {
          files.push({
            mimeType: att.mimeType,
            name: att.name,
            size: att.size,
            url: att.url,
          });
        }
      }
    }

    // 2. Attachments from referenced (quoted/replied-to) message (Discord raw payload)
    const raw = (message as any).raw as Record<string, any> | undefined;
    const refAttachments = raw?.referenced_message?.attachments as AttachmentLike[] | undefined;
    if (refAttachments?.length) {
      for (const att of refAttachments) {
        if (att.url) {
          files.push({
            mimeType: att.content_type,
            name: att.filename,
            size: att.size,
            url: att.url,
          });
        }
      }
    }

    return files.length > 0 ? files : undefined;
  }

  /**
   * Format user message into agent prompt.
   * Delegates to the standalone formatPrompt utility.
   */
  private formatPrompt(message: Message, botContext?: ChatTopicBotContext): string {
    return formatPromptUtil(message as any, botContext);
  }

  /**
   * Lazily load and cache user timezone from settings.
   */
  private async loadTimezone(): Promise<string | undefined> {
    if (this.timezoneLoaded) return this.timezone;

    try {
      const userModel = new UserModel(this.db, this.userId);
      const settings = await userModel.getUserSettings();
      this.timezone = (settings?.general as Record<string, unknown>)?.timezone as
        | string
        | undefined;
    } catch {
      // Fall back to server time if settings can't be loaded
    }

    this.timezoneLoaded = true;
    return this.timezone;
  }

  /**
   * Remove the received reaction from a user message (fire-and-forget).
   * @param reactionThreadId - The thread ID to use for the reaction API call.
   *   For messages in parent channels (handleMention), use parentChannelThreadId(thread.id).
   *   For messages inside threads (handleSubscribedMessage), use thread.id directly.
   */
  private async removeReceivedReaction(
    thread: Thread<ThreadState>,
    message: Message,
    reactionThreadId?: string,
  ): Promise<void> {
    await safeReaction(
      () =>
        thread.adapter.removeReaction(reactionThreadId ?? thread.id, message.id, RECEIVED_EMOJI),
      'remove eyes',
    );
  }
}
