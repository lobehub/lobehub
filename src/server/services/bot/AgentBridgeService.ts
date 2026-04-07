import type { ChatTopicBotContext, ExecAgentResult } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import type { Message, SentMessage, Thread } from 'chat';
import { emoji } from 'chat';
import debug from 'debug';

import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { createAbortError, isAbortError } from '@/server/services/agentRuntime/abort';
import { AiAgentService } from '@/server/services/aiAgent';
import { isQueueAgentRuntimeEnabled } from '@/server/services/queue/impls';
import { SystemAgentService } from '@/server/services/systemAgent';

import { formatPrompt as formatPromptUtil } from './formatPrompt';
import type { PlatformClient } from './platforms';
import { platformRegistry } from './platforms';
import {
  renderError,
  renderFinalReply,
  renderStart,
  renderStepProgress,
  renderStopped,
  splitMessage,
} from './replyTemplate';

const log = debug('lobe-server:bot:agent-bridge');

const EXECUTION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

// If the last activity in a bot topic is older than this threshold,
// create a new topic instead of continuing in the stale one.
const TOPIC_STALE_THRESHOLD = 4 * 60 * 60 * 1000; // 4 hours

// PostgreSQL error code for foreign key constraint violations.
// See: https://www.postgresql.org/docs/current/errcodes-appendix.html
const PG_FOREIGN_KEY_VIOLATION = '23503';

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
  displayToolCalls?: boolean;
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
    const { agentId, botContext, charLimit, displayToolCalls } = opts;

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

    try {
      // executeWithCallback handles progress message (post + edit at each step)
      // The final reply is edited into the progress message by onComplete
      const { topicId } = await this.executeWithCallback(thread, message, {
        agentId,
        botContext,
        channelContext,
        charLimit,
        client,
        displayToolCalls,
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
      // If setup fails before that point, clean up locally to avoid leaked reactions.
      if (!queueMode || !queueHandoffSucceeded) {
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
    const { agentId, botContext, charLimit, displayToolCalls } = opts;
    const threadState = await thread.state;
    const topicId = threadState?.topicId;

    log('handleSubscribedMessage: agentId=%s, thread=%s, topicId=%s', agentId, thread.id, topicId);

    if (!topicId) {
      log('handleSubscribedMessage: no topicId in thread state, treating as new mention');
      return this.handleMention(thread, message, opts);
    }

    // Skip if there's already an active execution for this thread.
    // This must run before the stale-topic check to prevent a race where
    // a concurrent message clears topicId (stale reset) and then no-ops
    // in handleMention because the thread is active — dropping the message
    // but leaving state cleared so the next message starts a fresh topic.
    if (AgentBridgeService.activeThreads.has(thread.id)) {
      log(
        'handleSubscribedMessage: skipping, thread=%s already has an active execution',
        thread.id,
      );
      return;
    }

    // Check if the topic is stale (no activity for 4+ hours).
    // If so, clear the cached topicId and start a fresh conversation.
    // Wrapped in try/catch so transient DB errors fall through to the
    // existing topicId rather than rejecting before the guarded section.
    try {
      const topicModel = new TopicModel(this.db, this.userId);
      const existingTopic = await topicModel.findById(topicId);
      if (existingTopic) {
        const elapsed = Date.now() - new Date(existingTopic.updatedAt).getTime();
        if (elapsed > TOPIC_STALE_THRESHOLD) {
          log(
            'handleSubscribedMessage: topic=%s is stale (%.1fh since last activity), creating new topic',
            topicId,
            elapsed / (60 * 60 * 1000),
          );
          await thread.setState({ ...threadState, topicId: undefined });
          return this.handleMention(thread, message, opts);
        }
      }
    } catch (error) {
      log(
        'handleSubscribedMessage: stale-topic lookup failed, continuing with existing topicId=%s: %O',
        topicId,
        error,
      );
    }

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

    try {
      // executeWithCallback handles progress message (post + edit at each step)
      await this.executeWithCallback(thread, message, {
        agentId,
        botContext,
        channelContext,
        charLimit,
        client: opts.client,
        displayToolCalls,
        topicId,
        trigger: RequestTrigger.Bot,
      });
      queueHandoffSucceeded = queueMode;
    } catch (error) {
      // If the cached topicId references a deleted topic (FK violation),
      // clear thread state and retry as a fresh mention instead of surfacing the DB error.
      const cause = (error as any)?.cause;
      const isFKViolation =
        cause?.code === PG_FOREIGN_KEY_VIOLATION && cause?.constraint?.includes('topic_id');
      const errMsg = error instanceof Error ? error.message : String(error);
      if (isFKViolation) {
        log(
          'handleSubscribedMessage: stale topicId=%s, resetting and retrying as new mention',
          topicId,
        );
        AgentBridgeService.activeThreads.delete(thread.id);
        await thread.setState({ ...threadState, topicId: undefined });
        return this.handleMention(thread, message, opts);
      }

      log('handleSubscribedMessage error: %O', error);
      await thread.post(`**Agent Execution Failed**. Details:\n\`\`\`\n${errMsg}\n\`\`\``);
    } finally {
      AgentBridgeService.activeThreads.delete(thread.id);
      // In queue mode, the callback owns cleanup only after webhook handoff succeeds.
      if (!queueMode || !queueHandoffSucceeded) {
        await this.removeReceivedReaction(thread, message, opts.client);
      }
    }
  }

  /**
   * Execute agent with unified hooks — auto-adapts to local or queue mode.
   *
   * Local mode: hooks run in-process, Promise resolves when agent completes.
   * Queue mode: hooks deliver via webhooks, returns immediately after startup.
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
      displayToolCalls?: boolean;
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

    const { agentId, botContext, channelContext, charLimit, client, displayToolCalls, topicId, trigger } = opts;

    const queueMode = isQueueAgentRuntimeEnabled();
    const aiAgentService = new AiAgentService(this.db, this.userId);
    const timezone = await this.loadTimezone();

    await thread.startTyping();

    let progressMessage: SentMessage | undefined;
    try {
      progressMessage = await thread.post(renderStart(userMessage.text, { timezone }));
    } catch (error) {
      log('executeWithCallback: failed to post initial placeholder message: %O', error);
    }

    const files = this.extractFiles(userMessage);
    const prompt = this.formatPrompt(userMessage, client);

    // Build webhook config for production mode
    const callbackUrl = '/api/agent/webhooks/bot-callback';
    const webhookBody = {
      applicationId: botContext?.applicationId,
      platformThreadId: botContext?.platformThreadId,
      progressMessageId: progressMessage?.id,
      userMessageId: userMessage.id,
    };

    log(
      'executeWithCallback: agentId=%s, queueMode=%s, prompt=%s, files=%d',
      agentId,
      queueMode,
      prompt.slice(0, 100),
      files?.length ?? 0,
    );

    // In queue mode, return immediately after startup — hooks handle the rest via webhooks
    if (queueMode) {
      return this.executeWithHooksQueueMode(thread, userMessage, aiAgentService, {
        agentId,
        botContext,
        botPlatformContext,
        callbackUrl,
        channelContext,
        files,
        progressMessage,
        prompt,
        topicId,
        trigger,
        webhookBody,
      });
    }

    // In local mode, wrap in a Promise — hook handlers resolve/reject it in-process
    return this.executeWithHooksLocalMode(thread, aiAgentService, {
      agentId,
      botContext,
      botPlatformContext,
      callbackUrl,
      charLimit,
      channelContext,
      client,
      displayToolCalls,
      files,
      progressMessage,
      prompt,
      topicId,
      trigger,
      webhookBody,
    });
  }

  /**
   * Queue mode: register hooks with webhook config, start agent, return immediately.
   */
  private async executeWithHooksQueueMode(
    thread: Thread<ThreadState>,
    userMessage: Message,
    aiAgentService: AiAgentService,
    opts: {
      agentId: string;
      botContext?: ChatTopicBotContext;
      botPlatformContext?: { platformName: string; supportsMarkdown: boolean };
      callbackUrl: string;
      channelContext?: DiscordChannelContext;
      files?: any;
      progressMessage?: SentMessage;
      prompt: string;
      topicId?: string;
      trigger?: string;
      webhookBody: Record<string, unknown>;
    },
  ): Promise<{ reply: string; topicId: string }> {
    const {
      agentId,
      botContext,
      botPlatformContext,
      callbackUrl,
      channelContext,
      files,
      progressMessage,
      prompt,
      topicId,
      trigger,
      webhookBody,
    } = opts;

    let result: ExecAgentResult;
    try {
      result = await AgentBridgeService.runWithStartupSignal(thread.id, (signal) =>
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
          hooks: [
            {
              handler: async () => {
                /* local handler not used in queue mode */
              },
              id: 'bot-step-progress',
              type: 'afterStep',
              webhook: {
                body: { ...webhookBody, type: 'step' },
                delivery: 'qstash',
                url: callbackUrl,
              },
            },
            {
              handler: async () => {
                /* local handler not used in queue mode */
              },
              id: 'bot-completion',
              type: 'onComplete',
              webhook: {
                body: { ...webhookBody, type: 'completion', userPrompt: prompt },
                delivery: 'qstash',
                url: callbackUrl,
              },
            },
          ],
          prompt,
          signal,
          title: '',
          trigger,
          userInterventionConfig: { approvalMode: 'headless' },
        }),
      );
    } catch (error) {
      log('executeWithCallback[queue]: execAgent failed: %O', error);

      const errMsg = error instanceof Error ? error.message : String(error);
      if (errMsg.includes('Failed query') && errMsg.includes('topic_id')) {
        throw error;
      }

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
      'executeWithCallback[queue]: operationId=%s, topicId=%s (returning immediately)',
      result.operationId,
      result.topicId,
    );

    if (result.operationId) {
      AgentBridgeService.activeOperations.set(thread.id, result.operationId);

      if (AgentBridgeService.consumeStopRequest(thread.id)) {
        try {
          await this.interruptTrackedOperation(thread.id, result.operationId);
        } catch (error) {
          log(
            'executeWithCallback[queue]: deferred stop failed for thread=%s: %O',
            thread.id,
            error,
          );
        }
      }
    }

    return { reply: '', topicId: result.topicId };
  }

  /**
   * Local mode: register hooks with in-process handlers, wait for completion via Promise.
   */
  private async executeWithHooksLocalMode(
    thread: Thread<ThreadState>,
    aiAgentService: AiAgentService,
    opts: {
      agentId: string;
      botContext?: ChatTopicBotContext;
      botPlatformContext?: { platformName: string; supportsMarkdown: boolean };
      callbackUrl: string;
      charLimit?: number;
      channelContext?: DiscordChannelContext;
      client?: PlatformClient;
      displayToolCalls?: boolean;
      files?: any;
      progressMessage?: SentMessage;
      prompt: string;
      topicId?: string;
      trigger?: string;
      webhookBody: Record<string, unknown>;
    },
  ): Promise<{ reply: string; topicId: string }> {
    const {
      agentId,
      botContext,
      botPlatformContext,
      callbackUrl,
      charLimit,
      channelContext,
      client,
      displayToolCalls,
      files,
      prompt,
      topicId,
      trigger,
      webhookBody,
    } = opts;

    let { progressMessage } = opts;
    let operationStartTime = 0;

    return new Promise<{ reply: string; topicId: string }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Agent execution timed out`));
      }, EXECUTION_TIMEOUT);

      let resolvedTopicId = topicId ?? '';

      const getElapsedMs = () => (operationStartTime > 0 ? Date.now() - operationStartTime : 0);

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
          hooks: [
            {
              handler: async (event) => {
                if (!event.shouldContinue || !progressMessage || displayToolCalls === false) return;

                const msgBody = renderStepProgress({
                  content: event.content,
                  elapsedMs: event.elapsedMs ?? getElapsedMs(),
                  executionTimeMs: event.executionTimeMs ?? 0,
                  lastContent: event.lastLLMContent,
                  lastToolsCalling: event.lastToolsCalling,
                  reasoning: event.reasoning,
                  stepType: (event.stepType as 'call_llm' | 'call_tool') ?? 'call_llm',
                  thinking: event.thinking ?? false,
                  toolsCalling: event.toolsCalling,
                  toolsResult: event.toolsResult,
                  totalCost: event.totalCost ?? 0,
                  totalInputTokens: event.totalInputTokens ?? 0,
                  totalOutputTokens: event.totalOutputTokens ?? 0,
                  totalSteps: event.totalSteps ?? 0,
                  totalTokens: event.totalTokens ?? 0,
                  totalToolCalls: event.totalToolCalls ?? 0,
                });

                const stats = {
                  elapsedMs: event.elapsedMs ?? getElapsedMs(),
                  totalCost: event.totalCost ?? 0,
                  totalTokens: event.totalTokens ?? 0,
                };
                const formatted = client?.formatMarkdown?.(msgBody) ?? msgBody;
                const progressText = client?.formatReply?.(formatted, stats) ?? formatted;

                try {
                  progressMessage = await progressMessage.edit(progressText);
                } catch (error) {
                  log('executeWithCallback[local]: failed to edit progress message: %O', error);
                }
              },
              id: 'bot-step-progress',
              type: 'afterStep' as const,
              webhook: {
                body: { ...webhookBody, type: 'step' },
                delivery: 'qstash' as const,
                url: callbackUrl,
              },
            },
            {
              handler: async (event) => {
                clearTimeout(timeout);

                const reason = event.reason;
                log('onComplete: reason=%s', reason);

                if (reason === 'error') {
                  const errorMsg = event.errorMessage || 'Agent execution failed';
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
                  const lastAssistantContent = event.lastAssistantContent;

                  if (lastAssistantContent) {
                    const replyBody = renderFinalReply(lastAssistantContent);
                    const replyStats = {
                      elapsedMs: event.duration ?? getElapsedMs(),
                      llmCalls: event.llmCalls ?? 0,
                      toolCalls: event.toolCalls ?? 0,
                      totalCost: event.cost ?? 0,
                      totalTokens: event.totalTokens ?? 0,
                    };
                    const formattedBody = client?.formatMarkdown?.(replyBody) ?? replyBody;
                    const finalText =
                      client?.formatReply?.(formattedBody, replyStats) ?? formattedBody;

                    const chunks = splitMessage(finalText, charLimit);

                    try {
                      if (progressMessage) {
                        await progressMessage.edit(chunks[0]);
                        for (let i = 1; i < chunks.length; i++) {
                          await thread.post(chunks[i]);
                        }
                      } else {
                        for (const chunk of chunks) {
                          await thread.post(chunk);
                        }
                      }
                    } catch (error) {
                      log('executeWithCallback[local]: failed to send final message: %O', error);
                    }

                    log(
                      'executeWithCallback[local]: got response (%d chars, %d chunks)',
                      lastAssistantContent.length,
                      chunks.length,
                    );
                    resolve({ reply: lastAssistantContent, topicId: resolvedTopicId });

                    // Fire-and-forget: summarize topic title in DB
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
                            'executeWithCallback[local]: topic title summarization failed: %O',
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
              id: 'bot-completion',
              type: 'onComplete' as const,
              webhook: {
                body: { ...webhookBody, type: 'completion', userPrompt: prompt },
                delivery: 'qstash' as const,
                url: callbackUrl,
              },
            },
          ],
          prompt,
          signal,
          title: '',
          trigger,
          userInterventionConfig: { approvalMode: 'headless' },
        }),
      )
        .then(async (result) => {
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
                log('executeWithCallback[local]: failed to edit startup error: %O', error);
              }
            }

            resolve({ reply: '', topicId: result.topicId });
            return;
          }

          if (result.operationId) {
            AgentBridgeService.activeOperations.set(thread.id, result.operationId);

            if (AgentBridgeService.consumeStopRequest(thread.id)) {
              try {
                await this.interruptTrackedOperation(thread.id, result.operationId);
              } catch (error) {
                log(
                  'executeWithCallback[local]: deferred stop failed for thread=%s: %O',
                  thread.id,
                  error,
                );
              }
            }
          }

          log(
            'executeWithCallback[local]: operationId=%s, topicId=%s',
            result.operationId,
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
                log('executeWithCallback[local]: failed to edit stopped message: %O', editError);
              }
            }

            resolve({ reply: '', topicId: topicId ?? '' });
            return;
          }

          if (progressMessage) {
            try {
              await progressMessage.edit(renderError(extractErrorMessage(error)));
            } catch (editError) {
              log('executeWithCallback[local]: failed to edit startup error: %O', editError);
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
  private extractFiles(message: Message):
    | Array<{
        buffer?: Buffer;
        mimeType?: string;
        name?: string;
        size?: number;
        url: string;
      }>
    | undefined {
    type AttachmentLike = {
      buffer?: Buffer;
      content_type?: string;
      filename?: string;
      mimeType?: string;
      name?: string;
      size?: number;
      type?: string;
      url?: string;
    };

    const files: Array<{
      buffer?: Buffer;
      mimeType?: string;
      name?: string;
      size?: number;
      url: string;
    }> = [];

    // 1. Direct attachments from the message (parsed by Chat SDK)
    const directAttachments = (message as any).attachments as AttachmentLike[] | undefined;
    if (directAttachments?.length) {
      for (const att of directAttachments) {
        if (att.url || att.buffer) {
          files.push({
            buffer: att.buffer,
            mimeType: att.mimeType,
            name: att.name,
            size: att.size,
            url: att.url || '',
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
