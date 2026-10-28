import type { Chat, Message, MessageContext } from 'chat';

import type { LobeChatDatabase } from '@/database/type';

import type { AgentBridgeService } from '../AgentBridgeService';
import type {
  BotReactionMode,
  BotReplyLocale,
  DmSettings,
  PlatformClient,
  ReplyEmojiEntry,
  WatchKeywordEntry,
} from '../platforms';
import type { WakeMessageLike } from '../wake/signal';
import type { FollowupGate } from './followupGate';
import type { BotWakeEntryPoint, BotWakeInitiation, BotWakeReason } from './wakeDecision';

export interface ResolvedAgentInfo {
  agentId: string;
  userId: string;
  workspaceId?: string;
}

export interface RegisteredBot {
  /** Chat SDK adapters keyed by platform id, as passed to the `Chat` config. */
  adapters: Record<string, any>;
  agentInfo: ResolvedAgentInfo;
  chatBot: Chat<any>;
  client: PlatformClient;
}

/** Context passed to every command handler — a minimal surface shared by both
 *  native slash-command events and text-based message events. */
export interface CommandContext {
  /** Text after the command name (e.g. "/new foo" → "foo"). */
  args: string;
  /** Platform user ID of the invoking user. Optional because the source
   *  event may not carry one (best-effort), but commands that gate on
   *  identity (e.g. `/approve` requires the owner) treat its absence as
   *  failure. */
  authorUserId?: string;
  /** Display name of the invoking user. Optional because some platforms
   *  surface only the ID, not a friendly label. */
  authorUserName?: string;
  /** Read the conversation's persisted state (topicId / toolMode / …).
   *  Wired to `thread.state` on text dispatch and `channel.state` on native
   *  slash dispatch — the same store `setState` writes to on each path. */
  getState: () => Promise<Record<string, any> | null>;
  post: (text: string) => Promise<any>;
  /**
   * Post a reply visible only to the invoker.
   *
   * Set only on native-slash paths (Slack / Discord) where chat-sdk knows
   * the interaction context — Slack uses native ephemeral, Discord uses an
   * ephemeral interaction response, both fall back to a DM if needed
   * (`fallbackToDM: true`). Undefined on text-based platforms (Telegram,
   * Feishu) — handlers should fall back to `post` there since those
   * platforms have no per-user ephemeral primitive.
   *
   * Used by `/feedback` so the user's feedback text and the bot's
   * confirmation don't leak into the public channel; other commands keep
   * using `post` to preserve the existing channel-visible behaviour
   * (e.g. `/new` resetting is useful for everyone to see).
   */
  postEphemeral?: (text: string) => Promise<any>;
  /** Locale to use for any system-generated reply text. Plumbed in by the
   *  caller — text-based commands derive it per-message via the platform's
   *  `extractAuthorLocale`, native slash commands fall back to the platform
   *  default since their event shape doesn't always carry user locale. */
  replyLocale: BotReplyLocale;
  setState: (state: Record<string, any>, opts?: { replace?: boolean }) => Promise<any>;
  threadId: string;
}

/** A single bot command definition.
 *  Add new entries to `buildCommands()` to register additional commands. */
export interface BotCommand {
  /**
   * Skip the allowFrom / DM-policy / group-policy gate for this command.
   * Reserved for commands with no side effects that only reveal the
   * caller's own data (e.g. `/whoami`), so an operator who hasn't filled in
   * `settings.userId` yet can still discover it under a `pairing` /
   * `allowlist` / `disabled` DM policy that would otherwise lock them out.
   */
  bypassGate?: boolean;
  description: string;
  handler: (ctx: CommandContext) => Promise<void>;
  name: string;
  /**
   * Native slash-command argument schema for platforms that require
   * arguments to be declared up-front (Discord, Slack). Without this,
   * Discord registers the command as zero-arg — clicking it from the
   * slash menu fires the handler with `ctx.args` empty even when the
   * user expected to pass a value. Adapters flatten option values back
   * into `event.text`, so the handler still reads `ctx.args` as before.
   *
   * Text-based platforms (Telegram / Feishu) ignore this and parse args
   * from the trailing message text via the dispatch regex.
   */
  options?: Array<{
    description: string;
    name: string;
    required?: boolean;
  }>;
}

/**
 * Access gate shared by the message handlers and the command dispatchers:
 * global `allowFrom`, Guest / group / DM policy and the paid-feature check.
 * Returns true when the inbound may proceed; on rejection the gate has
 * already posted the appropriate notice in the thread.
 */
export type BotAccessGate = (
  thread: { id: string; isDM?: boolean; post: (t: string) => Promise<unknown> },
  author: { userId?: string; userName?: string },
  replyLocale: BotReplyLocale,
  caller: string,
) => Promise<boolean>;

/** The owner's reply style for one conversation and the emoji the bot may use there. */
export interface BotReplyVoice {
  replyEmojis?: ReplyEmojiEntry[];
  replyStyle?: string;
}

/** Per-bot values `registerHandlers` hands to the DM / keyword catch-all. */
export interface BotHandlerContext {
  agentId: string;
  applicationId: string;
  /** The bot has the bot-wake scenario enabled: it listens to unaddressed channel chatter. */
  botWakeEnabled: boolean;
  bridge: AgentBridgeService;
  charLimit?: number;
  client: PlatformClient;
  commands: BotCommand[];
  detectReplyLocale: (message: { author?: unknown }) => BotReplyLocale;
  displayToolCalls: boolean;
  dmSettings: DmSettings;
  /** Last check before a follow-up wake (watch keyword) runs: enforced policies, then the scheduler. */
  gateFollowup: FollowupGate;
  /**
   * Whether a message nobody addressed to the bot should wake it anyway (its name is in the text,
   * or it spoke lately and the classifier agrees). `undefined` unless the rules are enforcing.
   */
  initiate: (
    entryPoint: BotWakeEntryPoint,
    message: WakeMessageLike,
    thread: { id: string },
    threadSubscribed?: boolean,
  ) => Promise<BotWakeInitiation | undefined>;
  /**
   * The `bot_wake` rollout flag for this bot's owner. Until it is on, every wake is answered, as
   * it was before the pipeline existed.
   */
  isBotWakeRolledOut: () => Promise<boolean>;
  isMessageMonitoringAllowed: (caller: string, threadId: string) => Promise<boolean>;
  /** Watch keywords the owner marked as the bot's names (`asName`); a subset of `watchKeywords`. */
  nameKeywords: ReadonlyArray<string>;
  /** Records the wake decision a branch just made. Observation only; never throws. */
  observe: (
    entryPoint: BotWakeEntryPoint,
    message: WakeMessageLike,
    thread: { id: string },
    outcome: 'defer' | 'skip' | 'wake',
    reason: BotWakeReason,
    threadSubscribed?: boolean,
  ) => void;
  /** Records a skipped burst: the merged latest message, and each other person's parked one. */
  observeBurst: (
    entryPoint: BotWakeEntryPoint,
    message: Message,
    context: MessageContext | undefined,
    thread: { id: string },
    threadSubscribed?: boolean,
  ) => void;
  operatorUserId?: string;
  passGatesOrNotify: BotAccessGate;
  platform: string;
  reactionMode: BotReactionMode;
  /** Keeps what people said, burst included, in the channel's shared log. Never throws. */
  remember: (
    entryPoint: BotWakeEntryPoint,
    messages: WakeMessageLike[],
    thread: { id: string },
  ) => void;
  /** How the bot talks in a conversation: the owner's reply style for it and the emoji it may use. */
  replyVoiceFor: (platformThreadId: string) => BotReplyVoice;
  serverDB: LobeChatDatabase;
  /**
   * Opens the reply to a message that woke the bot (an acknowledgement, and the channel or a new
   * thread), records the wake, and returns the acknowledgement it posted. Swaps `thread.id` when a
   * thread opens. Call `release` once the bridge has taken the run: until then the channel stays
   * claimed, so a concurrent opening does not pick it too.
   */
  startReply: (input: {
    entryPoint: BotWakeEntryPoint;
    /** The previous behaviour opened a reply thread here; kept when the bot does not decide. */
    legacyOpensThread?: boolean;
    message: WakeMessageLike;
    rawMessage: unknown;
    reason: BotWakeReason;
    thread: {
      id: string;
      post: (message: string) => Promise<unknown>;
      startTyping?: () => Promise<unknown>;
    };
    threadSubscribed?: boolean;
    wakeKind: 'followup' | 'mention';
  }) => Promise<{ openingReply?: string; release: () => void }>;
  userId: string;
  watchKeywordEntries: WatchKeywordEntry[];
  watchKeywords: ReadonlyArray<string>;
  workspaceId?: string;
}
