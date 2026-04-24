import type { ChatTopicBotContext, ExecAgentResult } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import type { Message, SentMessage, Thread } from 'chat';
import debug from 'debug';

import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { createAbortError, isAbortError } from '@/server/services/agentRuntime/abort';
import { AiAgentService } from '@/server/services/aiAgent';
import { getMessageGatewayClient } from '@/server/services/gateway/MessageGatewayClient';
import { isQueueAgentRuntimeEnabled } from '@/server/services/queue/impls';
import { SystemAgentService } from '@/server/services/systemAgent';

import { formatPrompt as formatPromptUtil } from './formatPrompt';
import type { PlatformClient } from './platforms';
import {
  getStepReactionEmoji,
  platformRegistry,
  RECEIVED_REACTION_EMOJI,
  THINKING_REACTION_EMOJI,
} from './platforms';
import { clearReactionState, saveReactionState } from './reactionState';
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
 * Fire-and-forget wrapper for non-essential side effects (reactions, typing
 * indicators, subscribe, etc.). These are UX niceties — a transient platform
 * network error must NEVER abort the main message flow, because the abort
 * would skip the cleanup of `activeThreads` and freeze the thread.
 */
async function safeSideEffect(fn: () => Promise<unknown>, label: string): Promise<void> {
  try {
    await fn();
  } catch (error) {
    log('safeSideEffect [%s] failed: %O', label, error);
  }
}

interface DiscordChannelContext {
  channel: { id: string; name?: string; topic?: string; type?: number };
  guild: { id: string };
  thread?: { id: string; name?: string };
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

/** Snapshot of the emoji currently applied to a given user message. */
interface ActiveReaction {
  applicationId?: string;
  emoji: string;
  platform?: string;
  reactionThreadId: string;
  userMessageId: string;
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
   * Per-thread snapshot of the emoji currently attached to the user message.
   * Used by the in-memory execution path so that consecutive step callbacks
   * can remove the previous emoji before adding a new one. Queue mode relies
   * on Redis (`reactionState`) for the same purpose since callbacks land in a
   * different process.
   */
  private static activeReactions = new Map<string, ActiveReaction>();

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
    AgentBridgeService.activeReactions.delete(threadId);
  }

  /**
   * Apply (or swap to) the given emoji on a user message. Tracks the current
   * emoji in an in-process map so the next call can remove it before adding
   * the new one — the user only ever sees one bot reaction at a time.
   *
   * When `botContext` is provided (queue mode hand-off), the new state is
   * also mirrored to Redis so the webhook callback service — which runs in a
   * different process — can pick up swapping from here.
   *
   * All platform API calls are fire-and-forget via `safeSideEffect`: a
   * transient reaction error must never abort the main message flow.
   */
  private async setReaction(
    thread: Thread<ThreadState>,
    message: Message,
    client: PlatformClient | undefined,
    nextEmoji: string,
    botContext?: ChatTopicBotContext,
  ): Promise<void> {
    const reactionThreadId = client?.resolveReactionThreadId?.(thread.id, message.id) ?? thread.id;
    const current = AgentBridgeService.activeReactions.get(thread.id);
    if (current && current.emoji === nextEmoji && current.userMessageId === message.id) {
      return;
    }
    const prevEmoji = current?.userMessageId === message.id ? current.emoji : null;
    const messenger = client?.getMessenger(reactionThreadId);
    await safeSideEffect(
      () => messenger?.replaceReaction?.(message.id, prevEmoji, nextEmoji) ?? Promise.resolve(),
      'replace reaction',
    );
    AgentBridgeService.activeReactions.set(thread.id, {
      applicationId: botContext?.applicationId,
      emoji: nextEmoji,
      platform: botContext?.platform,
      reactionThreadId,
      userMessageId: message.id,
    });

    if (botContext?.platform && botContext?.applicationId && message.id) {
      await saveReactionState(botContext.platform, botContext.applicationId, message.id, {
        emoji: nextEmoji,
        reactionThreadId,
      });
    }
  }

  /**
   * Remove whatever emoji is currently stored for this thread and drop the
   * tracking entry. Safe to call even when no reaction was set.
   */
  private async clearReaction(thread: Thread<ThreadState>, client?: PlatformClient): Promise<void> {
    const current = AgentBridgeService.activeReactions.get(thread.id);
    if (!current) return;
    AgentBridgeService.activeReactions.delete(thread.id);
    const messenger = client?.getMessenger(current.reactionThreadId);
    await safeSideEffect(
      () =>
        messenger?.replaceReaction?.(current.userMessageId, current.emoji, null) ??
        Promise.resolve(),
      'clear reaction',
    );
    if (current.platform && current.applicationId) {
      await clearReactionState(current.platform, current.applicationId, current.userMessageId);
    }
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
    client?: PlatformClient;
    error?: unknown;
    operationId?: string;
    progressMessage?: SentMessage;
    stopped?: boolean;
    thread: Thread<ThreadState>;
    userMessage: Message;
  }): Promise<void> {
    const { client, error, operationId, progressMessage, stopped, thread, userMessage } = params;
    const errorMessage =
      error instanceof Error ? error.message : error ? String(error) : 'Agent execution failed';

    log(
      'finishStartupFailure: thread=%s, operationId=%s, stopped=%s, error=%s',
      thread.id,
      operationId,
      stopped,
      errorMessage,
    );

    AgentBridgeService.clearActiveThread(thread.id);

    const errorContent = stopped ? renderStopped(errorMessage) : renderError(operationId);

    if (progressMessage) {
      try {
        await progressMessage.edit(errorContent);
      } catch (editError) {
        log('finishStartupFailure: failed to edit progress message: %O', editError);
      }
    } else {
      // No placeholder message (e.g. gateway typing mode) — post a new message
      // so the user still sees the error instead of a silently frozen typing indicator.
      try {
        await thread.post(errorContent);
      } catch (postError) {
        log('finishStartupFailure: failed to post error message: %O', postError);
      }
    }

    await this.clearReaction(thread, client);
    void userMessage;
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
      'handleMention: agentId=%s, user=%s, text=%s, attachments=%d',
      agentId,
      this.userId,
      message.text.slice(0, 80),
      ((message as any).attachments as unknown[] | undefined)?.length ?? 0,
    );

    // Skip if there's already an active execution for this thread
    if (AgentBridgeService.activeThreads.has(thread.id)) {
      log('handleMention: skipping, thread=%s already has an active execution', thread.id);
      return;
    }

    const { client } = opts;
    const queueMode = isQueueAgentRuntimeEnabled();
    let queueHandoffSucceeded = false;

    // Mark the thread as active and run the rest inside a try/finally so the
    // active flag is ALWAYS released even if a side-effect call (subscribe /
    // startTyping / addReaction) throws on a transient platform network error.
    AgentBridgeService.activeThreads.add(thread.id);

    try {
      // Immediate feedback: mark as received + show typing. Both are
      // non-essential UX niceties; a transient platform network error here
      // (e.g. ECONNRESET to api.telegram.org) must NOT abort the main flow.
      await this.setReaction(thread, message, client, RECEIVED_REACTION_EMOJI, botContext);

      // Auto-subscribe to thread (platforms can opt out, e.g. Discord top-level channels)
      const subscribe = client?.shouldSubscribe?.(thread.id) ?? true;
      if (subscribe) {
        await safeSideEffect(() => thread.subscribe(), 'subscribe');
      }

      await safeSideEffect(() => thread.startTyping(), 'startTyping');

      // Fetch channel context for Discord context injection
      const channelContext = await this.fetchChannelContext(thread);

      // Transition from "received" to "thinking" right before we hand off to
      // the agent runtime. The first afterStep hook fires only after the
      // first LLM call completes (often 5-10s), so without this swap the
      // user would see 👀 for the entire duration of the first LLM call.
      await this.setReaction(thread, message, client, THINKING_REACTION_EMOJI, botContext);

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
        try {
          await thread.post(renderError());
        } catch (postError) {
          log('handleMention: failed to post error message: %O', postError);
        }
      }
    } finally {
      AgentBridgeService.activeThreads.delete(thread.id);
      // In queue mode, the callback owns cleanup only after webhook handoff succeeds.
      // If setup fails before that point, clean up locally to avoid leaked reactions.
      if (!queueMode || !queueHandoffSucceeded) {
        await this.clearReaction(thread, client);
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

    log(
      'handleSubscribedMessage: agentId=%s, thread=%s, topicId=%s, attachments=%d',
      agentId,
      thread.id,
      topicId,
      ((message as any).attachments as unknown[] | undefined)?.length ?? 0,
    );

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

    // Read cached channel context from thread state
    const channelContext = threadState?.channelContext;

    const queueMode = isQueueAgentRuntimeEnabled();
    let queueHandoffSucceeded = false;

    // Mark the thread as active and run the rest inside a try/finally so the
    // active flag is ALWAYS released. Earlier this `add` happened outside the
    // try block, and a network error from `thread.startTyping()` would escape
    // before we entered the try — leaving the thread permanently locked
    // ("already has an active execution") until process restart.
    AgentBridgeService.activeThreads.add(thread.id);

    try {
      // Immediate feedback: mark as received + show typing. Both are
      // non-essential UX niceties; a transient platform network error here
      // (e.g. ECONNRESET to api.telegram.org) must NOT abort the main flow.
      await this.setReaction(thread, message, opts.client, RECEIVED_REACTION_EMOJI, botContext);
      await safeSideEffect(() => thread.startTyping(), 'startTyping');

      // Transition from "received" to "thinking" right before we hand off to
      // the agent runtime. The first afterStep hook fires only after the
      // first LLM call completes (often 5-10s), so without this swap the
      // user would see 👀 for the entire duration of the first LLM call.
      await this.setReaction(thread, message, opts.client, THINKING_REACTION_EMOJI, botContext);

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
        try {
          await thread.post(`**Agent Execution Failed**. Details:\n\`\`\`\n${errMsg}\n\`\`\``);
        } catch (postError) {
          log('handleSubscribedMessage: failed to post error message: %O', postError);
        }
      }
    } finally {
      AgentBridgeService.activeThreads.delete(thread.id);
      // In queue mode, the callback owns cleanup only after webhook handoff succeeds.
      if (!queueMode || !queueHandoffSucceeded) {
        await this.clearReaction(thread, opts.client);
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
    let botPlatformContext:
      | { platformName: string; supportsMarkdown: boolean; warnings?: string[] }
      | undefined;
    if (opts.botContext?.platform) {
      const platformDef = platformRegistry.getPlatform(opts.botContext.platform);
      if (platformDef) {
        botPlatformContext = {
          platformName: platformDef.name,
          supportsMarkdown: platformDef.supportsMarkdown !== false,
        };
      }
    }

    const {
      agentId,
      botContext,
      channelContext,
      charLimit,
      client,
      displayToolCalls,
      topicId,
      trigger,
    } = opts;

    const queueMode = isQueueAgentRuntimeEnabled();
    const aiAgentService = new AiAgentService(this.db, this.userId);
    const timezone = await this.loadTimezone();

    // When the message-gateway is configured AND the platform supports typing
    // indicators, skip the ack/progress message and rely on the gateway's
    // alarm-based typing indicator throughout AI generation.
    // Posting an ack message cancels platform-level typing (e.g. Discord), and the
    // gateway typing makes ack redundant as user feedback.
    // For platforms without typing support (no triggerTyping on messenger), the
    // gateway typing is invisible, so we still send an ack message as user feedback.
    const gwClient = getMessageGatewayClient();
    const platformSupportsTyping =
      client && botContext?.platformThreadId
        ? !!client.getMessenger(botContext.platformThreadId).triggerTyping
        : true;
    const useGatewayTyping = gwClient.isEnabled && platformSupportsTyping;

    let progressMessage: SentMessage | undefined;
    let gatewayConnectionId: string | undefined;
    if (useGatewayTyping) {
      log('executeWithWebhooks: using gateway typing, skipping ack message');

      // Platform typing (best-effort, must not block AI generation)
      await safeSideEffect(() => thread.startTyping(), 'startTyping (executeWithWebhooks)');

      // Start gateway typing immediately so the alarm keeps it alive through
      // the entire AI generation (platform typing expires after ~10s).
      if (botContext?.platformThreadId && botContext?.applicationId) {
        const platform = botContext.platformThreadId.split(':')[0];
        try {
          const row = await AgentBotProviderModel.findByPlatformAndAppId(
            this.db,
            platform,
            botContext.applicationId,
          );
          if (row?.id) {
            gatewayConnectionId = row.id;
            gwClient.startTyping(row.id, botContext.platformThreadId!).catch((err) => {
              log('executeWithWebhooks: gateway startTyping failed: %O', err);
            });
          }
        } catch (err) {
          log('executeWithWebhooks: gateway provider lookup failed: %O', err);
        }
      }
    } else {
      await safeSideEffect(() => thread.startTyping(), 'startTyping (executeWithWebhooks)');
      try {
        progressMessage = await thread.post(renderStart(userMessage.text, { timezone }));
      } catch (error) {
        log('executeWithWebhooks: failed to post initial placeholder message: %O', error);
      }
    }

    const { files, warnings: fileWarnings } = await this.resolveFiles(userMessage, client);
    const prompt = this.formatPrompt(userMessage, client);

    // Attach file warnings to botPlatformContext for injection via context engine
    if (fileWarnings?.length && botPlatformContext) {
      botPlatformContext.warnings = fileWarnings;
    }

    // Build webhook config for production mode
    const callbackUrl = '/api/agent/webhooks/bot-callback';
    const webhookBody = {
      applicationId: botContext?.applicationId,
      platformThreadId: botContext?.platformThreadId,
      progressMessageId: progressMessage?.id,
      // Pass thread name only if it's user-set.
      // Bot-generated threads use "Thread <locale date>" (e.g. "Thread 4/9/2026, 6:00:00 PM"),
      // which always starts with "Thread " followed by a digit.
      threadName:
        channelContext?.thread?.name && /^Thread \d/.test(channelContext.thread.name)
          ? undefined
          : channelContext?.thread?.name,
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
        client,
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
      gatewayConnectionId,
      progressMessage,
      prompt,
      topicId,
      trigger,
      userMessage,
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
      client?: PlatformClient;
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
      client,
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
            ? {
                channel: channelContext.channel,
                guild: channelContext.guild,
                thread: channelContext.thread,
              }
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
        client,
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
        client,
        error: result.error,
        operationId: result.operationId,
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
      gatewayConnectionId?: string;
      progressMessage?: SentMessage;
      prompt: string;
      topicId?: string;
      trigger?: string;
      userMessage?: Message;
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
      gatewayConnectionId,
      prompt,
      topicId,
      trigger,
      userMessage,
      webhookBody,
    } = opts;

    let { progressMessage } = opts;
    let operationStartTime = 0;

    const stopGatewayTyping = () => {
      if (gatewayConnectionId && botContext?.platformThreadId) {
        const gwClient = getMessageGatewayClient();
        gwClient.stopTyping(gatewayConnectionId, botContext.platformThreadId).catch((err) => {
          log('executeWithCallback[local]: gateway stopTyping failed: %O', err);
        });
      }
    };

    return new Promise<{ reply: string; topicId: string }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        stopGatewayTyping();
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
            ? {
                channel: channelContext.channel,
                guild: channelContext.guild,
                thread: channelContext.thread,
              }
            : undefined,
          files,
          hooks: [
            {
              handler: async (event) => {
                if (event.shouldContinue && userMessage) {
                  const desiredEmoji = getStepReactionEmoji(event.stepType, event.toolsCalling);
                  await this.setReaction(thread, userMessage, client, desiredEmoji, botContext);
                }

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
                stopGatewayTyping();

                const reason = event.reason;
                log('onComplete: reason=%s', reason);

                if (reason === 'error') {
                  const errorMsg = event.errorMessage || 'Agent execution failed';
                  log(
                    'onComplete: agent run failed, operationId=%s, errorMessage=%s',
                    event.operationId,
                    errorMsg,
                  );
                  try {
                    const errorText = renderError(event.operationId);
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

            log(
              'executeWithCallback[local]: startup failed, operationId=%s, error=%s',
              result.operationId,
              result.error,
            );

            if (progressMessage) {
              try {
                await progressMessage.edit(renderError(result.operationId));
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

          log('executeWithCallback[local]: startup error: %s', extractErrorMessage(error));

          // Stale topic_id FK violation: propagate so handleSubscribedMessage can
          // clear thread state and retry as a fresh mention. Queue mode does the
          // same bailout in executeWithHooksQueueMode.
          const errMsg = error instanceof Error ? error.message : String(error);
          if (errMsg.includes('Failed query') && errMsg.includes('topic_id')) {
            stopGatewayTyping();
            reject(error);
            return;
          }

          if (progressMessage) {
            try {
              await progressMessage.edit(renderError());
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
        threadId?: string;
      };

      if (!decoded?.guildId || !decoded?.channelId) {
        log('fetchChannelContext: could not decode guildId/channelId from thread %s', thread.id);
        return undefined;
      }

      // Fetch parent channel info
      const channelInfo = await thread.adapter.fetchThread(thread.id);
      const raw = channelInfo.metadata?.raw as { topic?: string; type?: number } | undefined;

      const context: DiscordChannelContext = {
        channel: {
          id: decoded.channelId,
          name: channelInfo.channelName,
          topic: raw?.topic,
          type: raw?.type,
        },
        guild: { id: decoded.guildId },
      };

      // When in a Discord thread, also fetch thread info.
      // Discord threads are channels, so we can fetch via /channels/{threadId}
      // by constructing a synthetic composite ID with threadId as the channelId slot.
      if (decoded.threadId) {
        try {
          const syntheticId = `discord:${decoded.guildId}:${decoded.threadId}`;
          const threadInfoResult = await thread.adapter.fetchThread(syntheticId);
          context.thread = {
            id: decoded.threadId,
            name: threadInfoResult.channelName,
          };
          log(
            'fetchChannelContext: thread=%s (%s)',
            decoded.threadId,
            threadInfoResult.channelName,
          );
        } catch (threadError) {
          log('fetchChannelContext: failed to fetch thread info: %O', threadError);
          // Still include thread ID even if name fetch fails
          context.thread = { id: decoded.threadId };
        }
      }

      log(
        'fetchChannelContext: guild=%s, channel=%s (%s), thread=%s',
        decoded.guildId,
        decoded.channelId,
        channelInfo.channelName,
        context.thread?.name ?? 'none',
      );

      return context;
    } catch (error) {
      log('fetchChannelContext: failed to fetch channel context: %O', error);
      return undefined;
    }
  }

  /**
   * Resolve attachments on an inbound message into `AttachmentSource[]` by
   * delegating to the platform client's own `extractFiles`. Each platform
   * owns its own attachment quirks (auth, file_id paths, mime/name
   * inference, quoted-msg handling, post-Redis refetch); the bridge stays
   * platform-agnostic.
   *
   * Returns undefined when no client is provided or the client returns no
   * attachments. (The legacy bridge fallback `extractFiles` was deleted
   * once all 6 platforms migrated to per-client extraction — see Step 2
   * of the per-platform extractFiles refactor.)
   */
  private async resolveFiles(
    message: Message,
    client?: PlatformClient,
  ): Promise<{
    files?: Array<{
      buffer?: Buffer;
      mimeType?: string;
      name?: string;
      size?: number;
      url?: string;
    }>;
    warnings?: string[];
  }> {
    const result = await client?.extractFiles?.(message);
    if (!result) return {};
    if (Array.isArray(result)) return { files: result };
    return { files: result.files, warnings: result.warnings };
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
}
