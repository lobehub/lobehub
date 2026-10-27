import type { ChatTopicBotContext } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import type { Message, Thread } from 'chat';
import debug from 'debug';

import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { createAbortError } from '@/server/services/agentRuntime/abort';
import { AiAgentService } from '@/server/services/aiAgent';
import { isQueueAgentRuntimeEnabled } from '@/server/services/queue/impls';

import type { BotReplyLocale, PlatformClient } from '../platforms';
import {
  DEFAULT_BOT_REACTION_MODE,
  getBotReplyLocale,
  RECEIVED_REACTION_EMOJI,
  shouldApplyReaction,
  THINKING_REACTION_EMOJI,
} from '../platforms';
import { clearReactionState, saveReactionState } from '../reactionState';
import { renderThrownAgentError } from '../renderThrownError';
import { renderErrorWithDetails, renderStopped } from '../replyTemplate';
import { deferWhileTopicBusy } from './deferral';
import { executeWithCallback } from './execute';
import { fetchChannelContext, resolveFiles } from './inbound';
import type {
  ActiveReaction,
  BridgeExecutionDeps,
  BridgeExecutionResult,
  BridgeHandlerOpts,
  StartupFailureParams,
  ThreadState,
} from './types';
import { isTopicBusyError, safeSideEffect } from './utils';

const log = debug('lobe-server:bot:agent-bridge');

// If the last activity in a bot topic is older than this threshold,
// create a new topic instead of continuing in the stale one.
const TOPIC_STALE_THRESHOLD = 4 * 60 * 60 * 1000; // 4 hours

// PostgreSQL error code for foreign key constraint violations.
// See: https://www.postgresql.org/docs/current/errcodes-appendix.html
const PG_FOREIGN_KEY_VIOLATION = '23503';

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
  private readonly workspaceId?: string;

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

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private async interruptTrackedOperation(threadId: string, operationId: string): Promise<void> {
    const aiAgentService = new AiAgentService(this.db, this.userId, {
      workspaceId: this.workspaceId,
    });
    const result = await aiAgentService.interruptTask({ operationId });
    if (!result.success) {
      throw new Error(`Failed to interrupt operation ${operationId}`);
    }
    AgentBridgeService.clearActiveThread(threadId);
    log('interruptTrackedOperation: thread=%s, operationId=%s', threadId, operationId);
  }

  private async finishStartupFailure(params: StartupFailureParams): Promise<void> {
    const {
      alreadyReported,
      client,
      error,
      operationId,
      progressMessage,
      replyLocale,
      stopped,
      thread,
      userMessage,
    } = params;
    const errorMessage =
      error instanceof Error ? error.message : error ? String(error) : 'Agent execution failed';

    log(
      'finishStartupFailure: thread=%s, operationId=%s, stopped=%s, alreadyReported=%s, error=%s',
      thread.id,
      operationId,
      stopped,
      alreadyReported,
      errorMessage,
    );

    AgentBridgeService.clearActiveThread(thread.id);

    // A stop is ours to report either way: the completion callback renders an
    // interrupted run, not this local "stopped" acknowledgement.
    if (alreadyReported && !stopped) {
      await this.clearReaction(thread, client);
      return;
    }

    // Classify before rendering so a startup failure lands on curated copy
    // (harness / provider / user tier) instead of a bare "Agent Execution
    // Failed" that tells the user nothing — especially when the run died
    // before it had an operation id to show.
    const errorContent = {
      markdown: stopped
        ? renderStopped(errorMessage, replyLocale)
        : renderThrownAgentError(error, operationId, replyLocale),
    };

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
   * Resolve the locale to use for system-generated reply text. Prefers the
   * caller-provided value (passed in by BotMessageRouter), falls back to a
   * platform-derived default so legacy callers still get the right copy.
   */
  private resolveReplyLocale(opts: BridgeHandlerOpts): BotReplyLocale {
    return opts.replyLocale ?? getBotReplyLocale(opts.botContext?.platform);
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
    const reactionMode = opts.reactionMode ?? DEFAULT_BOT_REACTION_MODE;
    const replyLocale = this.resolveReplyLocale(opts);

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

    // A wake the bot started itself (catch-all initiation) may end in silence, so nothing the user
    // can see is shown until the agent starts acting — the same as `handleSubscribedMessage`.
    const wakeKind = opts.wakeKind ?? 'mention';
    const deferFeedback = wakeKind === 'followup';

    try {
      // Immediate feedback: mark as received + show typing. Both are
      // non-essential UX niceties; a transient platform network error here
      // (e.g. ECONNRESET to api.telegram.org) must NOT abort the main flow.
      if (!deferFeedback && shouldApplyReaction(reactionMode, 'received')) {
        await this.setReaction(thread, message, client, RECEIVED_REACTION_EMOJI, botContext);
      }

      // Auto-subscribe to thread (platforms can opt out, e.g. Discord top-level channels)
      const subscribe = client?.shouldSubscribe?.(thread.id) ?? true;
      if (subscribe) {
        await safeSideEffect(() => thread.subscribe(), 'subscribe');
      }

      if (!deferFeedback) await safeSideEffect(() => thread.startTyping(), 'startTyping');

      // Fetch channel context for Discord context injection
      const channelContext = await this.fetchChannelContext(thread);

      // Transition from "received" to "thinking" right before we hand off to
      // the agent runtime. The first afterStep hook fires only after the
      // first LLM call completes (often 5-10s), so without this swap the
      // user would see 👀 for the entire duration of the first LLM call.
      if (!deferFeedback && shouldApplyReaction(reactionMode, 'thinking')) {
        await this.setReaction(thread, message, client, THINKING_REACTION_EMOJI, botContext);
      }

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
          proactive: opts.proactive,
          reactionMode,
          replyLocale,
          trigger: RequestTrigger.Bot,
          wakeKind,
        });
        queueHandoffSucceeded = queueMode;

        // Persist topic mapping and channel context in thread state for follow-up messages
        // Skip if the platform opted out of auto-subscribe (no subscribe = no follow-up)
        if (topicId && subscribe) {
          await thread.setState({ channelContext, topicId });
          log('handleMention: stored topicId=%s in thread=%s state', topicId, thread.id);
        }
      } catch (error) {
        const operationId = AgentBridgeService.activeOperations.get(thread.id);
        log('handleMention error: operationId=%s, %O', operationId, error);
        try {
          await thread.post({ markdown: renderThrownAgentError(error, operationId, replyLocale) });
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
    const reactionMode = opts.reactionMode ?? DEFAULT_BOT_REACTION_MODE;
    const replyLocale = this.resolveReplyLocale(opts);
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

    // Validate the cached topic before reusing it. Three reset triggers, all
    // resolved the same way — clear the cached topicId and start a fresh
    // conversation via handleMention:
    //   1. the topic row is gone (deleted directly, cascade-deleted with its
    //      agent, or out of the current user/workspace ownership scope after a
    //      scope switch) — running with it would fail at the topic-start
    //      reservation with a bare "Agent Execution Failed" and no way out;
    //   2. the topic belongs to a different agent than the active one — the
    //      user switched agents via /agents, so continuing the old agent's
    //      topic would be wrong even when it still exists;
    //   3. the topic is stale (no activity for 4+ hours).
    // Wrapped in try/catch so transient DB errors fall through to the
    // existing topicId rather than rejecting before the guarded section.
    try {
      const topicModel = new TopicModel(this.db, this.userId, this.workspaceId);
      const existingTopic = await topicModel.findById(topicId);
      if (!existingTopic) {
        log(
          'handleSubscribedMessage: cached topic=%s no longer exists, creating new topic',
          topicId,
        );
        await thread.setState({ ...threadState, topicId: undefined });
        return this.handleMention(thread, message, opts);
      }
      if (existingTopic.agentId && existingTopic.agentId !== agentId) {
        log(
          'handleSubscribedMessage: cached topic=%s belongs to agent=%s but active agent is %s, creating new topic',
          topicId,
          existingTopic.agentId,
          agentId,
        );
        await thread.setState({ ...threadState, topicId: undefined });
        return this.handleMention(thread, message, opts);
      }
      // A platform thread that is itself a bounded conversation (e.g. a
      // Discord guild thread) keeps its topic regardless of idle time — a
      // reply hours later is still the same conversation.
      const expiresWhenIdle = opts.client?.shouldExpireIdleTopic?.(thread.id) ?? true;
      const elapsed = Date.now() - new Date(existingTopic.updatedAt).getTime();
      if (expiresWhenIdle && elapsed > TOPIC_STALE_THRESHOLD) {
        log(
          'handleSubscribedMessage: topic=%s is stale (%.1fh since last activity), creating new topic',
          topicId,
          elapsed / (60 * 60 * 1000),
        );
        await thread.setState({ ...threadState, topicId: undefined });
        return this.handleMention(thread, message, opts);
      }

      // In queue mode the previous run may still be executing on the job
      // queue even though the thread lock and `activeThreads` were released
      // at handoff. Starting a second run now would lose the topic-start
      // reservation race and surface as "Agent Execution Failed" — the
      // WeChat "one image + one sentence" case. Park the message instead;
      // the completion callback replays it once the topic is idle.
      const runningOperation = existingTopic.metadata?.runningOperation;
      if (
        runningOperation &&
        isQueueAgentRuntimeEnabled() &&
        (await topicModel.isRunningOperationAlive(this.db, runningOperation))
      ) {
        const deferred = await this.deferWhileTopicBusy(thread, message, botContext, topicId);
        if (deferred) return;
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

    // A follow-up wake may end in silence, so nothing the user can see (👀, typing, progress
    // message) is shown until the agent starts acting — see `deferredFeedback` in `./execute`.
    const wakeKind = opts.wakeKind ?? 'mention';
    const deferFeedback = wakeKind === 'followup';

    try {
      if (!deferFeedback) {
        // Immediate feedback: mark as received + show typing. Both are
        // non-essential UX niceties; a transient platform network error here
        // (e.g. ECONNRESET to api.telegram.org) must NOT abort the main flow.
        if (shouldApplyReaction(reactionMode, 'received')) {
          await this.setReaction(thread, message, opts.client, RECEIVED_REACTION_EMOJI, botContext);
        }
        await safeSideEffect(() => thread.startTyping(), 'startTyping');

        // Transition from "received" to "thinking" right before we hand off to
        // the agent runtime. The first afterStep hook fires only after the
        // first LLM call completes (often 5-10s), so without this swap the
        // user would see 👀 for the entire duration of the first LLM call.
        if (shouldApplyReaction(reactionMode, 'thinking')) {
          await this.setReaction(thread, message, opts.client, THINKING_REACTION_EMOJI, botContext);
        }
      }

      try {
        // executeWithCallback handles progress message (post + edit at each step)
        await this.executeWithCallback(thread, message, {
          agentId,
          botContext,
          channelContext,
          charLimit,
          client: opts.client,
          displayToolCalls,
          reactionMode,
          proactive: opts.proactive,
          replyLocale,
          topicId,
          trigger: RequestTrigger.Bot,
          wakeKind,
        });
        queueHandoffSucceeded = queueMode;
      } catch (error) {
        // If the cached topicId references a deleted topic (FK violation),
        // clear thread state and retry as a fresh mention instead of surfacing the DB error.
        const cause = (error as any)?.cause;
        const isFKViolation =
          cause?.code === PG_FOREIGN_KEY_VIOLATION && cause?.constraint?.includes('topic_id');
        const errMsg = error instanceof Error ? error.message : String(error);
        // "Topic not found" comes from the topic-start reservation when the
        // cached topic row is gone (same stale-topic class as the FK
        // violation, just surfaced from a different layer).
        const isStaleTopic = isFKViolation || errMsg.includes('Topic not found');
        if (isStaleTopic) {
          log(
            'handleSubscribedMessage: stale topicId=%s, resetting and retrying as new mention',
            topicId,
          );
          AgentBridgeService.activeThreads.delete(thread.id);
          await thread.setState({ ...threadState, topicId: undefined });
          return this.handleMention(thread, message, opts);
        }

        // The pre-flight liveness check above and the reservation are not
        // atomic: a run that started between them still makes the
        // reservation give up with "remained busy". Same remedy — park the
        // message for replay instead of telling the user the agent failed.
        if (queueMode && isTopicBusyError(errMsg)) {
          const deferred = await this.deferWhileTopicBusy(thread, message, botContext, topicId);
          if (deferred) return;
        }

        const operationId = AgentBridgeService.activeOperations.get(thread.id);
        log('handleSubscribedMessage error: operationId=%s, %O', operationId, error);
        try {
          await thread.post({
            markdown: renderErrorWithDetails(errMsg, replyLocale, operationId),
          });
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
   * The slice of this instance the extracted execution stages need. Static
   * registries are passed by reference so every stage shares one instance.
   */
  private executionDeps(): BridgeExecutionDeps {
    return {
      activeOperations: AgentBridgeService.activeOperations,
      consumeStopRequest: (threadId) => AgentBridgeService.consumeStopRequest(threadId),
      db: this.db,
      finishStartupFailure: (params) => this.finishStartupFailure(params),
      interruptTrackedOperation: (threadId, operationId) =>
        this.interruptTrackedOperation(threadId, operationId),
      loadTimezone: () => this.loadTimezone(),
      runWithStartupSignal: (threadId, task) =>
        AgentBridgeService.runWithStartupSignal(threadId, task),
      setReaction: (thread, message, client, nextEmoji, botContext) =>
        this.setReaction(thread, message, client, nextEmoji, botContext),
      userId: this.userId,
      workspaceId: this.workspaceId,
    };
  }

  /** See `executeWithCallback` in `./execute`. */
  private executeWithCallback(
    thread: Thread<ThreadState>,
    userMessage: Message,
    opts: Parameters<typeof executeWithCallback>[3],
  ): Promise<BridgeExecutionResult> {
    return executeWithCallback(this.executionDeps(), thread, userMessage, opts);
  }

  /** See `fetchChannelContext` in `./inbound`. */
  private fetchChannelContext(thread: Thread<ThreadState>) {
    return fetchChannelContext(thread);
  }

  /** See `resolveFiles` in `./inbound`. */
  private resolveFiles(message: Message, client?: PlatformClient) {
    return resolveFiles(message, client);
  }

  /** See `deferWhileTopicBusy` in `./deferral`. */
  private deferWhileTopicBusy(
    thread: Thread<ThreadState>,
    message: Message,
    botContext: ChatTopicBotContext | undefined,
    topicId: string,
  ): Promise<boolean> {
    return deferWhileTopicBusy(this.executionDeps(), thread, message, botContext, topicId);
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
        string | undefined;
    } catch {
      // Fall back to server time if settings can't be loaded
    }

    this.timezoneLoaded = true;
    return this.timezone;
  }
}
