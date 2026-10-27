import type { BotNoReplyResult, BotWakeKind, ChatTopicBotContext } from '@lobechat/types';
import type { Message, SentMessage, Thread } from 'chat';

import type { LobeChatDatabase } from '@/database/type';

import type { BotReactionMode, BotReplyLocale, PlatformClient } from '../platforms';

export interface DiscordChannelContext {
  channel: { id: string; name?: string; topic?: string; type?: number };
  guild: { id: string };
  thread?: { id: string; name?: string };
}

export interface ThreadState {
  channelContext?: DiscordChannelContext;
  /**
   * Per-conversation execution mode set via the `/mode` command. When present
   * it overrides the agent's own `chatConfig.toolMode` for every run in this
   * thread; absent means "follow the agent's configured default".
   */
  toolMode?: 'agent' | 'chat';
  topicId?: string;
}

export interface BridgeHandlerOpts {
  agentId: string;
  botContext?: ChatTopicBotContext;
  charLimit?: number;
  client?: PlatformClient;
  displayToolCalls?: boolean;
  /**
   * The bot woke on its own to offer its owner help nobody asked for (a `followup` wake); the
   * agent is told why. See `formatBotPlatformContext`.
   */
  proactive?: boolean;
  /**
   * Status-reaction verbosity (see `BotReactionMode`). Defaults to
   * `DEFAULT_BOT_REACTION_MODE` for callers that predate the setting.
   */
  reactionMode?: BotReactionMode;
  /**
   * Locale for system-generated reply text (errors, stopped notice, etc.).
   * Picked per platform — see `getBotReplyLocale`. When omitted we fall back
   * to inferring from `botContext.platform`, then to English.
   */
  replyLocale?: BotReplyLocale;
  /**
   * How the bot was woken. `followup` lets the agent end in silence and holds back every visible
   * side effect (reaction, typing, progress message) until it decides to speak; `mention`
   * (the default) is the always-answer path and is unchanged.
   */
  wakeKind?: BotWakeKind;
}

/** What an execution resolves with. `noReply` is set when the agent chose silence. */
export interface BridgeExecutionResult {
  noReply?: BotNoReplyResult;
  reply: string;
  topicId: string;
}

/** Snapshot of the emoji currently applied to a given user message. */
export interface ActiveReaction {
  applicationId?: string;
  emoji: string;
  platform?: string;
  reactionThreadId: string;
  userMessageId: string;
}

/** Inputs of `AgentBridgeService.finishStartupFailure`. */
export interface StartupFailureParams {
  /**
   * The run's terminal lifecycle already fired its `onComplete` hooks, which
   * include this bot's own completion callback (see `ExecAgentResult.
   * terminalReported`). Posting here as well is what used to leave two error
   * messages — the curated card and the callback's — in the same thread, so
   * this path only cleans up and lets the callback own the reply.
   */
  alreadyReported?: boolean;
  client?: PlatformClient;
  error?: unknown;
  operationId?: string;
  progressMessage?: SentMessage;
  replyLocale?: BotReplyLocale;
  stopped?: boolean;
  thread: Thread<ThreadState>;
  userMessage: Message;
}

/**
 * What the execution stages read off the service: the bound identity, the
 * process-wide operation registry, and the reaction / startup helpers whose
 * state lives on the class.
 */
export interface BridgeExecutionDeps {
  activeOperations: Map<string, string>;
  consumeStopRequest: (threadId: string) => boolean;
  db: LobeChatDatabase;
  finishStartupFailure: (params: StartupFailureParams) => Promise<void>;
  interruptTrackedOperation: (threadId: string, operationId: string) => Promise<void>;
  loadTimezone: () => Promise<string | undefined>;
  runWithStartupSignal: <T>(
    threadId: string,
    task: (signal: AbortSignal) => Promise<T>,
  ) => Promise<T>;
  setReaction: (
    thread: Thread<ThreadState>,
    message: Message,
    client: PlatformClient | undefined,
    nextEmoji: string,
    botContext?: ChatTopicBotContext,
  ) => Promise<void>;
  userId: string;
  workspaceId?: string;
}
