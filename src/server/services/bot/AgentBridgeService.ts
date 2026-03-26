import type { ChatTopicBotContext, ExecAgentResult } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import type { Message, SentMessage, Thread } from 'chat';
import { emoji } from 'chat';
import debug from 'debug';
import urlJoin from 'url-join';

import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { createAbortError, isAbortError } from '@/server/services/agentRuntime/abort';
import { AiAgentService } from '@/server/services/aiAgent';
import { isQueueAgentRuntimeEnabled } from '@/server/services/queue/impls';
import { SystemAgentService } from '@/server/services/systemAgent';

import { formatPrompt as formatPromptUtil } from './formatPrompt';
import type { PlatformClient } from './platforms';
import { platformRegistry } from './platforms';
import { DEFAULT_DEBOUNCE_MS } from './platforms/const';
import {
  renderError,
  renderFinalReply,
  renderStart,
  renderStepProgress,
  renderStopped,
  splitMessage,
} from './replyTemplate';
import { startTypingKeepAlive, stopTypingKeepAlive } from './typingKeepAlive';

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
  charLimit?: number;
  client?: PlatformClient;
  debounceMs?: number;
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

  /**
   * Tracks threads that have an active agent execution in progress.
   * In queue mode the Chat SDK lock is released before the agent finishes,
   * so we need our own guard to prevent duplicate executions on the same thread.
   */
  private static activeThreads = new Set<string>();

  /**
   * Maps platform thread ID → operationId for active executions.
   * Used by /stop to interrupt a running agent via AiAgentService.interruptTask.
   */
  private static activeOperations = new Map<string, string>();

  /**
   * Abort controllers for startup work before execAgent returns an operationId.
   * Allows /stop to cancel topic/tool/message preparation in the current process.
   */
  private static startupControllers = new Map<string, AbortController>();

  /**
   * Threads where the user requested /stop before we had an operationId.
   * Once the operationId becomes available we immediately interrupt it.
   */
  private static pendingStopThreads = new Set<string>();

  /**
   * Check if a thread currently has an active agent execution.
   */
  static isThreadActive(threadId: string): boolean {
    return AgentBridgeService.activeThreads.has(threadId);
  }

  /**
   * Get the operationId for an active execution on the given thread.
   */
  static getActiveOperationId(threadId: string): string | undefined {
    return AgentBridgeService.activeOperations.get(threadId);
  }

  /**
   * Remove a thread from the active set, e.g. when /stop cancels execution.
   */
  static clearActiveThread(threadId: string): void {
    AgentBridgeService.activeThreads.delete(threadId);
    AgentBridgeService.activeOperations.delete(threadId);
    AgentBridgeService.pendingStopThreads.delete(threadId);
    AgentBridgeService.startupControllers.delete(threadId);
  }

  /**
   * Mark a thread as waiting for interruption once its operationId is known.
   */
  static requestStop(threadId: string): void {
    AgentBridgeService.pendingStopThreads.add(threadId);
    const controller = AgentBridgeService.startupControllers.get(threadId);
    if (controller && !controller.signal.aborted) {
      controller.abort(createAbortError('Execution stopped before startup.'));
    }
  }

  /**
   * Consume a pending stop request for a thread.
   */
  static consumeStopRequest(threadId: string): boolean {
    const hasPendingStop = AgentBridgeService.pendingStopThreads.has(threadId);
    if (hasPendingStop) {
      AgentBridgeService.pendingStopThreads.delete(threadId);
    }
    return hasPendingStop;
  }

  /**
   * Run startup work under a per-thread AbortSignal so /stop can cancel it
   * before an operationId exists.
   */
  private static async runWithStartupSignal<T>(
    threadId: string,
    task: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    AgentBridgeService.startupControllers.set(threadId, controller);

    try {
      return await task(controller.signal);
    } finally {
      if (AgentBridgeService.startupControllers.get(threadId) === controller) {
        AgentBridgeService.startupControllers.delete(threadId);
      }
    }
  }

  /**
   * Debounce buffer for incoming messages per thread.
   * Users often send multiple short messages in quick succession (e.g. "hello" + "how are you").
   * Instead of triggering separate agent executions for each, we collect messages arriving
   * within a short window and merge them into a single prompt.
   */
  private static pendingMessages = new Map<
    string,
    {
      messages: Message[];
      resolve: () => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  /**
   * Buffer a message and return a promise that resolves when the debounce window closes.
   * Returns the collected messages if this call "wins" the debounce (is the first),
   * or null if the message was appended to an existing pending batch.
   *
   * Messages with attachments flush immediately (no debounce) to avoid delaying
   * file-heavy interactions.
   */
  private static bufferMessage(
    threadId: string,
    message: Message,
    debounceMs: number,
  ): Promise<Message[] | null> {
    // Flush immediately if the message has attachments
    const hasAttachments = !!(message as any).attachments?.length;

    const existing = AgentBridgeService.pendingMessages.get(threadId);

    if (existing) {
      // Append to existing batch and reset the timer
      existing.messages.push(message);
      clearTimeout(existing.timer);

      if (hasAttachments) {
        // Flush now
        existing.resolve();
      } else {
        existing.timer = setTimeout(() => existing.resolve(), debounceMs);
      }

      return Promise.resolve(null); // not the owner
    }

    // First message — create a new batch
    if (hasAttachments) {
      return Promise.resolve([message]); // no debounce
    }

    return new Promise<Message[]>((resolve) => {
      const batch = {
        messages: [message],
        resolve: () => {
          const entry = AgentBridgeService.pendingMessages.get(threadId);
          AgentBridgeService.pendingMessages.delete(threadId);
          resolve(entry?.messages ?? [message]);
        },
        timer: setTimeout(() => {
          const entry = AgentBridgeService.pendingMessages.get(threadId);
          if (entry) entry.resolve();
        }, debounceMs),
      };
      AgentBridgeService.pendingMessages.set(threadId, batch);
    });
  }

  /**
   * Merge multiple messages into a single synthetic Message for the agent.
   * Preserves the first message's metadata (author, raw, attachments) and
   * concatenates all text with newlines.
   */
  private static mergeMessages(messages: Message[]): Message {
    if (messages.length === 1) return messages[0];

    const first = messages[0];
    const mergedText = messages.map((m) => m.text).join('\n');

    return Object.assign(Object.create(Object.getPrototypeOf(first)), first, {
      text: mergedText,
    });
  }

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  private async interruptTrackedOperation(threadId: string, operationId: string): Promise<void> {
    const aiAgentService = new AiAgentService(this.db, this.userId);
    const result = await aiAgentService.interruptTask({ operationId });
    if (!result.success) {
      throw new Error(`Failed to interrupt operation ${operationId}`);
    }
    AgentBridgeService.clearActiveThread(threadId);
    log('interruptTrackedOperation: thread=%s, operationId=%s', threadId, operationId);
  }

  private async finishStartupFailure(params: {
    error?: unknown;
    progressMessage?: SentMessage;
    stopped?: boolean;
    thread: Thread<ThreadState>;
    userMessage: Message;
  }): Promise<void> {
    const { error, progressMessage, stopped, thread, userMessage } = params;
    const errorMessage =
      error instanceof Error ? error.message : error ? String(error) : 'Agent execution failed';

    AgentBridgeService.clearActiveThread(thread.id);

    if (progressMessage) {
      try {
        await progressMessage.edit(
          stopped ? renderStopped(errorMessage) : renderError(errorMessage),
        );
      } catch (editError) {
        log('finishStartupFailure: failed to edit progress message: %O', editError);
      }
    }

    await this.removeReceivedReaction(thread, userMessage);
  }

  /**
   * Handle a new @mention — start a fresh conversation.
   */
  async handleMention(
    thread: Thread<ThreadState>,
    message: Message,
    opts: BridgeHandlerOpts,
  ): Promise<void> {
    const { agentId, botContext, charLimit, debounceMs } = opts;

    log(
      'handleMention: agentId=%s, user=%s, text=%s',
      agentId,
      this.userId,
      message.text.slice(0, 80),
    );

    // Skip if there's already an active execution for this thread
    if (AgentBridgeService.activeThreads.has(thread.id)) {
      log('handleMention: skipping, thread=%s already has an active execution', thread.id);
      return;
    }

    // Debounce: buffer rapid-fire messages and merge them into one prompt.
    // The first caller wins and drives the execution; subsequent callers
    // append their message to the buffer and return immediately.
    const batch = await AgentBridgeService.bufferMessage(
      thread.id,
      message,
      debounceMs ?? DEFAULT_DEBOUNCE_MS,
    );
    if (!batch) {
      log('handleMention: message buffered for thread=%s, waiting for debounce', thread.id);
      return;
    }

    const mergedMessage = AgentBridgeService.mergeMessages(batch);
    log(
      'handleMention: debounce done, %d message(s) merged for thread=%s',
      batch.length,
      thread.id,
    );

    AgentBridgeService.activeThreads.add(thread.id);

    // Immediate feedback: mark as received + show typing
    const { client } = opts;
    const reactionThreadId = client?.resolveReactionThreadId?.(thread.id, message.id) ?? thread.id;
    await safeReaction(
      () => thread.adapter.addReaction(reactionThreadId, message.id, RECEIVED_EMOJI),
      'add eyes',
    );

    // Auto-subscribe to thread (platforms can opt out, e.g. Discord top-level channels)
    const subscribe = client?.shouldSubscribe?.(thread.id) ?? true;
    if (subscribe) {
      await thread.subscribe();
    }

    await thread.startTyping();

    // Fetch channel context for Discord context injection
    const channelContext = await this.fetchChannelContext(thread);

    const queueMode = isQueueAgentRuntimeEnabled();
    let queueHandoffSucceeded = false;

    // Keep typing indicator alive (e.g. Telegram expires after ~5s, Discord after ~10s)
    const platformThreadId = botContext?.platformThreadId ?? thread.id;
    startTypingKeepAlive(platformThreadId, () => thread.startTyping());

    try {
      // executeWithCallback handles progress message (post + edit at each step)
      // The final reply is edited into the progress message by onComplete
      const { topicId } = await this.executeWithCallback(thread, mergedMessage, {
        agentId,
        botContext,
        channelContext,
        charLimit,
        client,
        trigger: RequestTrigger.Bot,
      });
      queueHandoffSucceeded = queueMode;

      // Persist topic mapping and channel context in thread state for follow-up messages
      // Skip if the platform opted out of auto-subscribe (no subscribe = no follow-up)
      if (topicId && subscribe) {
        await thread.setState({ channelContext, topicId });
        log('handleMention: stored topicId=%s in thread=%s state', topicId, thread.id);
      }
    } catch (error) {
      log('handleMention error: %O', error);
      const msg = error instanceof Error ? error.message : String(error);
      await thread.post(`**Agent Execution Failed**\n\`\`\`\n${msg}\n\`\`\``);
    } finally {
      AgentBridgeService.activeThreads.delete(thread.id);
      // In queue mode, the callback owns cleanup only after webhook handoff succeeds.
      // If setup fails before that point, clean up locally to avoid leaked keepalive/reactions.
      if (!queueMode || !queueHandoffSucceeded) {
        stopTypingKeepAlive(platformThreadId);
        await this.removeReceivedReaction(thread, message, client);
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
    const { agentId, botContext, charLimit, debounceMs } = opts;
    const threadState = await thread.state;
    const topicId = threadState?.topicId;

    log('handleSubscribedMessage: agentId=%s, thread=%s, topicId=%s', agentId, thread.id, topicId);

    if (!topicId) {
      log('handleSubscribedMessage: no topicId in thread state, treating as new mention');
      return this.handleMention(thread, message, opts);
    }

    // Skip if there's already an active execution for this thread
    if (AgentBridgeService.activeThreads.has(thread.id)) {
      log(
        'handleSubscribedMessage: skipping, thread=%s already has an active execution',
        thread.id,
      );
      return;
    }

    // Debounce: same as handleMention — merge rapid-fire messages
    const batch = await AgentBridgeService.bufferMessage(
      thread.id,
      message,
      debounceMs ?? DEFAULT_DEBOUNCE_MS,
    );
    if (!batch) {
      log('handleSubscribedMessage: message buffered for thread=%s', thread.id);
      return;
    }

    const mergedMessage = AgentBridgeService.mergeMessages(batch);
    log(
      'handleSubscribedMessage: debounce done, %d message(s) merged for thread=%s',
      batch.length,
      thread.id,
    );

    AgentBridgeService.activeThreads.add(thread.id);

    // Read cached channel context from thread state
    const channelContext = threadState?.channelContext;

    const queueMode = isQueueAgentRuntimeEnabled();
    let queueHandoffSucceeded = false;

    // Immediate feedback: mark as received + show typing
    const reactionThreadId =
      opts.client?.resolveReactionThreadId?.(thread.id, message.id) ?? thread.id;
    await safeReaction(
      () => thread.adapter.addReaction(reactionThreadId, message.id, RECEIVED_EMOJI),
      'add eyes',
    );
    await thread.startTyping();

    // Keep typing indicator alive
    const platformThreadId = botContext?.platformThreadId ?? thread.id;
    startTypingKeepAlive(platformThreadId, () => thread.startTyping());

    try {
      // executeWithCallback handles progress message (post + edit at each step)
      await this.executeWithCallback(thread, mergedMessage, {
        agentId,
        botContext,
        channelContext,
        charLimit,
        client: opts.client,
        topicId,
        trigger: RequestTrigger.Bot,
      });
      queueHandoffSucceeded = queueMode;
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
        return this.handleMention(thread, message, opts);
      }

      log('handleSubscribedMessage error: %O', error);
      await thread.post(`**Agent Execution Failed**. Details:\n\`\`\`\n${errMsg}\n\`\`\``);
    } finally {
      AgentBridgeService.activeThreads.delete(thread.id);
      // In queue mode, the callback owns cleanup only after webhook handoff succeeds.
      if (!queueMode || !queueHandoffSucceeded) {
        stopTypingKeepAlive(platformThreadId);
        await this.removeReceivedReaction(thread, message, opts.client);
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
      charLimit?: number;
      client?: PlatformClient;
      topicId?: string;
      trigger?: string;
    },
  ): Promise<{ reply: string; topicId: string }> {
    // Resolve bot platform context from platform registry
    let botPlatformContext: { platformName: string; supportsMarkdown: boolean } | undefined;
    if (opts.botContext?.platform) {
      const platformDef = platformRegistry.getPlatform(opts.botContext.platform);
      if (platformDef) {
        botPlatformContext = {
          platformName: platformDef.name,
          supportsMarkdown: platformDef.supportsMarkdown !== false,
        };
      }
    }

    const optsWithPlatform = { ...opts, botPlatformContext };

    if (isQueueAgentRuntimeEnabled()) {
      return this.executeWithWebhooks(thread, userMessage, optsWithPlatform);
    }
    return this.executeWithInMemoryCallbacks(thread, userMessage, optsWithPlatform);
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
      botPlatformContext?: { platformName: string; supportsMarkdown: boolean };
      channelContext?: DiscordChannelContext;
      client?: PlatformClient;
      topicId?: string;
      trigger?: string;
    },
  ): Promise<{ reply: string; topicId: string }> {
    const { agentId, botContext, botPlatformContext, channelContext, client, topicId, trigger } =
      opts;

    const aiAgentService = new AiAgentService(this.db, this.userId);
    const timezone = await this.loadTimezone();

    // Platforms without message editing still get an initial placeholder message,
    // but completion will be sent as follow-up messages instead of editing in place.
    const canEdit = platformRegistry.getPlatform(client?.id ?? '')?.supportsMessageEdit !== false;

    let progressMessage: SentMessage | undefined;
    try {
      progressMessage = await thread.post(renderStart(userMessage.text, { timezone }));
    } catch (error) {
      log('executeWithWebhooks: failed to post initial placeholder message: %O', error);
    }

    const progressMessageId: string | undefined = progressMessage?.id;
    if (canEdit) {
      if (!progressMessageId) {
        throw new Error('Failed to post initial progress message');
      }

      // Refresh typing indicator after posting the ack message,
      // so typing stays active until the first step webhook arrives.
      await thread.startTyping();
    }

    // Build webhook URL for bot-callback endpoint
    // Prefer INTERNAL_APP_URL for server-to-server calls (bypasses CDN/proxy)
    const baseURL = appEnv.INTERNAL_APP_URL || appEnv.APP_URL;
    if (!baseURL) {
      throw new Error('APP_URL is required for queue mode bot webhooks');
    }
    const callbackUrl = urlJoin(baseURL, '/api/agent/webhooks/bot-callback');

    const webhookBody = {
      applicationId: botContext?.applicationId,
      platformThreadId: botContext?.platformThreadId,
      progressMessageId,
      userMessageId: userMessage.id,
    };

    const files = this.extractFiles(userMessage);
    const prompt = this.formatPrompt(userMessage, client);

    log(
      'executeWithWebhooks: agentId=%s, callbackUrl=%s, progressMessageId=%s, prompt=%s, files=%d',
      agentId,
      callbackUrl,
      progressMessageId,
      prompt.slice(0, 100),
      files?.length ?? 0,
    );

    let result: ExecAgentResult;
    try {
      result = await AgentBridgeService.runWithStartupSignal(thread.id, (signal) =>
        aiAgentService.execAgent({
          agentId,
          appContext: topicId ? { topicId } : undefined,
          autoStart: true,
          botContext,
          botPlatformContext,
          completionWebhook: { body: webhookBody, url: callbackUrl },
          discordContext: channelContext
            ? { channel: channelContext.channel, guild: channelContext.guild }
            : undefined,
          files,
          prompt,
          signal,
          stepWebhook: { body: webhookBody, url: callbackUrl },
          title: '',
          trigger,
          userInterventionConfig: { approvalMode: 'headless' },
          webhookDelivery: 'qstash',
        }),
      );
    } catch (error) {
      await this.finishStartupFailure({
        error,
        progressMessage,
        stopped: isAbortError(error),
        thread,
        userMessage,
      });
      return { reply: '', topicId: topicId ?? '' };
    }

    if (!result.success) {
      await this.finishStartupFailure({
        error: result.error,
        progressMessage,
        thread,
        userMessage,
      });
      return { reply: '', topicId: result.topicId };
    }

    log(
      'executeWithWebhooks: operationId=%s, topicId=%s (webhook mode, returning immediately)',
      result.operationId,
      result.topicId,
    );

    // Track operationId so /stop can interrupt this execution
    if (result.operationId) {
      AgentBridgeService.activeOperations.set(thread.id, result.operationId);

      if (AgentBridgeService.consumeStopRequest(thread.id)) {
        try {
          await this.interruptTrackedOperation(thread.id, result.operationId);
        } catch (error) {
          log(
            'executeWithWebhooks: deferred stop failed for thread=%s, operationId=%s: %O',
            thread.id,
            result.operationId,
            error,
          );
        }
      }
    }

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
      botPlatformContext?: { platformName: string; supportsMarkdown: boolean };
      channelContext?: DiscordChannelContext;
      charLimit?: number;
      client?: PlatformClient;
      topicId?: string;
      trigger?: string;
    },
  ): Promise<{ reply: string; topicId: string }> {
    const {
      agentId,
      botContext,
      botPlatformContext,
      channelContext,
      charLimit,
      client,
      topicId,
      trigger,
    } = opts;

    const aiAgentService = new AiAgentService(this.db, this.userId);
    const timezone = await this.loadTimezone();

    let progressMessage: SentMessage | undefined;
    try {
      progressMessage = await thread.post(renderStart(userMessage.text, { timezone }));
    } catch (error) {
      log('executeWithInMemoryCallbacks: failed to post initial placeholder message: %O', error);
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

      let assistantMessageId = '';
      let resolvedTopicId = topicId ?? '';

      const getElapsedMs = () => (operationStartTime > 0 ? Date.now() - operationStartTime : 0);

      const files = this.extractFiles(userMessage);
      const prompt = this.formatPrompt(userMessage, client);

      log(
        'executeWithInMemoryCallbacks: agentId=%s, prompt=%s, files=%d',
        agentId,
        prompt.slice(0, 100),
        files?.length ?? 0,
      );

      AgentBridgeService.runWithStartupSignal(thread.id, (signal) =>
        aiAgentService.execAgent({
          agentId,
          appContext: topicId ? { topicId } : undefined,
          autoStart: true,
          botContext,
          botPlatformContext,
          discordContext: channelContext
            ? { channel: channelContext.channel, guild: channelContext.guild }
            : undefined,
          files,
          prompt,
          signal,
          title: '',
          stepCallbacks: {
            onAfterStep: async (stepData) => {
              const { content, shouldContinue, toolsCalling } = stepData;
              if (!shouldContinue || !progressMessage) return;

              if (toolsCalling) totalToolCalls += toolsCalling.length;

              const msgBody = renderStepProgress({
                ...stepData,
                elapsedMs: getElapsedMs(),
                lastContent: lastLLMContent,
                lastToolsCalling,
                totalToolCalls,
              });

              const stats = {
                elapsedMs: getElapsedMs(),
                totalCost: stepData.totalCost ?? 0,
                totalTokens: stepData.totalTokens ?? 0,
              };
              const formatted = client?.formatMarkdown?.(msgBody) ?? msgBody;
              const progressText = client?.formatReply?.(formatted, stats) ?? formatted;

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
                try {
                  const errorText = renderError(errorMsg);
                  if (progressMessage) {
                    await progressMessage.edit(errorText);
                  } else {
                    await thread.post(errorText);
                  }
                } catch {
                  // ignore send failure
                }
                reject(new Error(errorMsg));
                return;
              }

              if (reason === 'interrupted') {
                if (progressMessage) {
                  try {
                    await progressMessage.edit(renderStopped());
                  } catch {
                    // ignore edit failure
                  }
                }
                resolve({ reply: '', topicId: resolvedTopicId });
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
                  const replyBody = renderFinalReply(lastAssistantContent);
                  const replyStats = {
                    elapsedMs: getElapsedMs(),
                    llmCalls: finalState.usage?.llm?.apiCalls ?? 0,
                    toolCalls: finalState.usage?.tools?.totalCalls ?? 0,
                    totalCost: finalState.cost?.total ?? 0,
                    totalTokens: finalState.usage?.llm?.tokens?.total ?? 0,
                  };
                  const formattedBody = client?.formatMarkdown?.(replyBody) ?? replyBody;
                  const finalText =
                    client?.formatReply?.(formattedBody, replyStats) ?? formattedBody;

                  const chunks = splitMessage(finalText, charLimit);

                  try {
                    if (progressMessage) {
                      await progressMessage.edit(chunks[0]);
                      // Post overflow chunks as follow-up messages
                      for (let i = 1; i < chunks.length; i++) {
                        await thread.post(chunks[i]);
                      }
                    } else {
                      // No progress message (non-editable platform) — post all chunks as new messages
                      for (const chunk of chunks) {
                        await thread.post(chunk);
                      }
                    }
                  } catch (error) {
                    log('executeWithInMemoryCallbacks: failed to send final message: %O', error);
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
        }),
      )
        .then(async (result) => {
          assistantMessageId = result.assistantMessageId;
          resolvedTopicId = result.topicId;
          operationStartTime = new Date(result.createdAt).getTime();

          if (!result.success) {
            clearTimeout(timeout);

            if (progressMessage) {
              try {
                await progressMessage.edit(
                  renderError(result.error || 'Agent operation failed to start'),
                );
              } catch (error) {
                log('executeWithInMemoryCallbacks: failed to edit startup error: %O', error);
              }
            }

            resolve({ reply: '', topicId: result.topicId });
            return;
          }

          // Track operationId so /stop can interrupt this execution
          if (result.operationId) {
            AgentBridgeService.activeOperations.set(thread.id, result.operationId);

            if (AgentBridgeService.consumeStopRequest(thread.id)) {
              try {
                await this.interruptTrackedOperation(thread.id, result.operationId);
              } catch (error) {
                log(
                  'executeWithInMemoryCallbacks: deferred stop failed for thread=%s, operationId=%s: %O',
                  thread.id,
                  result.operationId,
                  error,
                );
              }
            }
          }

          log(
            'executeWithInMemoryCallbacks: operationId=%s, assistantMessageId=%s, topicId=%s',
            result.operationId,
            result.assistantMessageId,
            result.topicId,
          );
        })
        .catch(async (error) => {
          clearTimeout(timeout);

          if (isAbortError(error)) {
            if (progressMessage) {
              try {
                await progressMessage.edit(renderStopped(error.message));
              } catch (editError) {
                log('executeWithInMemoryCallbacks: failed to edit stopped message: %O', editError);
              }
            }

            resolve({ reply: '', topicId: topicId ?? '' });
            return;
          }

          if (progressMessage) {
            try {
              await progressMessage.edit(renderError(extractErrorMessage(error)));
            } catch (editError) {
              log('executeWithInMemoryCallbacks: failed to edit startup error: %O', editError);
            }
          }

          resolve({ reply: '', topicId: topicId ?? '' });
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
  private formatPrompt(message: Message, client?: PlatformClient): string {
    return formatPromptUtil(message as any, {
      sanitizeUserInput: client?.sanitizeUserInput?.bind(client),
    });
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
   */
  private async removeReceivedReaction(
    thread: Thread<ThreadState>,
    message: Message,
    client?: PlatformClient,
  ): Promise<void> {
    const reactionThreadId = client?.resolveReactionThreadId?.(thread.id, message.id) ?? thread.id;
    await safeReaction(
      () => thread.adapter.removeReaction(reactionThreadId, message.id, RECEIVED_EMOJI),
      'remove eyes',
    );
  }
}
