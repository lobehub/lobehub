/** How one wake policy participates in the aggregate decision. */
export type WakePolicyMode = 'enforce' | 'off' | 'shadow';

export type WakeVerdict = 'abstain' | 'allow' | 'deny';

/**
 * Normalized fact a wake policy judges. Mirrors the `bot.message.merged` payload; policies never
 * see the raw source node so they stay independent of source-event plumbing.
 */
export interface WakeSignal {
  agentId?: string;
  applicationId?: string;
  /** Who wrote the message. Absent when the producer could not tell. */
  author?: WakeAuthor;
  /** Channel-level key (and, on Discord, the auto-created thread key) the state is filed under. */
  channelKeys?: WakeChannelKeys;
  /** Attachments (images, files) on the message; an attachment-only message is not empty. */
  hasAttachments?: boolean;
  /** Mentions parsed from the message itself, independent of what the platform adapter reported. */
  mentions?: WakeMentions;
  message: string;
  platform?: string;
  platformThreadId?: string;
  /**
   * Platform user id of the author of the message this one replies to (Discord replies only).
   * Absent when it is not a reply or the platform does not say.
   */
  replyToAuthorId?: string;
  timestamp: number;
}

/** Who wrote a message, as the platform reports it. */
export interface WakeAuthor {
  id?: string;
  /** Another bot or an integration. */
  isBot: boolean;
  /** This bot itself. */
  isMe: boolean;
  /** The bot's owner (the operator whose account configured it). */
  isOwner: boolean;
  /** A platform-generated message: a join notice, a pin, a thread rename. */
  isSystem: boolean;
}

/**
 * Mentions parsed from the message text/raw payload.
 *
 * The chat SDK's Discord adapter folds `@everyone`, `@here` and configured role pings into
 * `isMention`, so that flag cannot tell an @bot from a broadcast. This is the re-derived truth.
 */
export interface WakeMentions {
  /** The bot itself is @-mentioned by user id. */
  botMentioned: boolean;
  everyone: boolean;
  here: boolean;
  /** Users other than the bot that are @-mentioned. */
  otherUserIds: string[];
  roleIds: string[];
}

/**
 * Keys a channel's wake state is filed under. On Discord a mention makes the adapter open a
 * thread, so the bot speaks in `threadKey` while later messages may still arrive in `channelKey`
 * (or the other way round); both are written and read.
 */
export interface WakeChannelKeys {
  channelKey: string;
  /** Raw platform ids (channel, thread) the owner's allow/deny lists are matched against. */
  ids: string[];
  threadKey?: string;
}

/** One message of a channel's recent conversation, as kept for context. Never the full history. */
export interface WakeConversationLine {
  /** Epoch ms the message was sent. */
  at: number;
  authorId?: string;
  authorName?: string;
  /** Platform message id; the same message seen by two bots is one line. */
  id: string;
  /** Another bot, or this one. */
  isBot: boolean;
  text: string;
}

/**
 * What was said around a message: who the bot is, what it last said and the messages just before.
 * Read from a log shared by every bot in the channel, so it holds other people's words too.
 */
export interface WakeConversation {
  /** The agent behind the bot: its name and its title (identity or role). */
  agent?: { name?: string; title?: string };
  /** Names people may call the bot by (its platform username and display name). */
  botNames: string[];
  /** The bot's own latest message in this conversation, when it is still in the log. */
  lastBotMessage?: string;
  /** The bot owner's id on the platform, to mark their lines in the transcript. */
  ownerId?: string;
  /**
   * What the owner is called: their LobeHub name and the names they go by on the platform. Their
   * name is a person's, so a message that only says it is not addressed to the bot.
   */
  ownerNames?: string[];
  /** The messages before the one being judged, oldest first. */
  recent: WakeConversationLine[];
}

/**
 * Everything a wake policy may read besides the signal. The runner resolves it once per
 * evaluation, so policies stay pure and never touch the database, Redis or the clock.
 */
export interface WakeStateSnapshot {
  /** Channel state read from Redis, merged over the channel and thread keys. */
  channel?: WakeChannelState;
  /** Who the bot is and what was said just before; absent when no conversation could be read. */
  conversation?: WakeConversation;
  /** The message @-mentions the bot. */
  explicitMention: boolean;
  /** Epoch ms of the bot's latest reply in the thread, when known. */
  lastBotReplyAt?: number;
  /** The message replies to a message the bot sent. */
  replyToBot: boolean;
  /** The bot is subscribed to the thread. */
  threadSubscribed: boolean;
}

export type WakeStateKey = keyof WakeStateSnapshot;

/** Input handed to {@link WakePolicy.evaluate}: the signal plus only the state it declared. */
export interface WakePolicyContext<TKey extends WakeStateKey = WakeStateKey> {
  signal: Readonly<WakeSignal>;
  state: Readonly<Pick<WakeStateSnapshot, TKey>>;
}

export interface WakePolicyResult {
  /** 0..1, how sure the policy is about its verdict. */
  confidence: number;
  reason: string;
  tags: readonly string[];
  verdict: WakeVerdict;
}

/**
 * One pure wake judgement.
 *
 * Expects:
 * - `evaluate` is side-effect free; it reads only `ctx.signal` and the state keys listed in
 *   `requires`. Rule policies are synchronous; the classifier is the one that awaits a model.
 */
export interface WakePolicy<TKey extends WakeStateKey = WakeStateKey> {
  /**
   * Expensive policies (a model call) are skipped once an earlier policy has denied the message,
   * whatever its mode: the wake is already lost, so the spend would buy nothing.
   */
  costly?: boolean;
  /** May return a promise; only the async aggregator awaits it. */
  evaluate: (ctx: WakePolicyContext<TKey>) => Promise<WakePolicyResult> | WakePolicyResult;
  id: string;
  mode: WakePolicyMode;
  /** State snapshot keys this policy reads; undeclared keys are not passed in. */
  requires: readonly TKey[];
  version: number;
}

/** What one policy said, recorded whether or not it took effect. */
export interface WakePolicyRecord extends WakePolicyResult {
  /** `true` when the policy's verdict participated in the final decision (mode `enforce`). */
  effective: boolean;
  /** Wall-clock time the policy's `evaluate` took. */
  latencyMs: number;
  mode: Exclude<WakePolicyMode, 'off'>;
  policyId: string;
  policyVersion: number;
}

export interface WakeDecision {
  /** Policy that produced a short-circuiting deny. */
  decidedBy?: string;
  /** The explicit @bot / reply-to-bot path: no policy ran. */
  fastPath: boolean;
  reason: string;
  records: WakePolicyRecord[];
  /** Effective verdict: `abstain` when no enforcing policy took a position. */
  verdict: WakeVerdict;
}

/** Channel facts the bot-wake policies read; all times are epoch ms. */
export interface WakeChannelState {
  /** Latest time the bot posted in this channel or its thread. */
  botLastSpokeAt?: number;
  /** End of the follow-up window opened by the bot's last post. */
  followupUntil?: number;
  /** Latest time the bot's owner posted in this channel or its thread. */
  ownerLastSpokeAt?: number;
  /**
   * Follow-up wakes since the bot last spoke. Reset when it posts; grows when a wake ends in
   * silence.
   */
  silentWakes: number;
}

/** Where passive waking may happen. */
export type WakeRuleScope = 'all' | 'bot-threads' | 'none';

export interface WakeClassifierRules {
  /** `off` skips the model call, `shadow` scores without blocking, `enforce` lets a low score block. */
  mode: WakePolicyMode;
  /** Scores under this block the wake in `enforce`. */
  threshold: number;
}

/** The bot owner's rules, with defaults applied. See {@link parseBotWakeSettings}. */
export interface WakeRules {
  /** Raw platform channel/thread ids the bot may wake in; empty means anywhere. */
  allowChannels: string[];
  classifier: WakeClassifierRules & {
    /**
     * "Help others": outside the follow-up window the classifier may wake the bot on its own, for
     * a message that reads as meant for it although nobody named or @-mentioned it. Only while
     * the classifier enforces.
     */
    initiateEnabled: boolean;
    /** The score that starts such a wake; stricter than `threshold`. 0 also turns it off. */
    initiateThreshold: number;
  };
  /** Free text handed to the classifier as context. Never compiled into a rule. */
  customInstructions?: string;
  /** Raw platform channel/thread ids the bot never wakes in. Wins over the allow list. */
  denyChannels: string[];
  /** Follow-up wakes without the bot speaking before it stays quiet; 0 = no limit. */
  maxSilentWakes: number;
  /** The owner posted in the channel within this many seconds: stay quiet. 0 disables. */
  ownerPresenceSeconds: number;
  /** Offering the owner help nobody asked for. Uses `classifier`-style mode and threshold. */
  proactive: WakeClassifierRules;
  scope: WakeRuleScope;
  /** How long after the bot speaks plain messages count as a follow-up to it. */
  windowSeconds: number;
}

/** Channel scheduler settings; `off` (the default) leaves follow-up wakes immediate. */
export interface WakeSchedulerConfig {
  /** Minimum time a burst of messages is collected before the bot runs. */
  collectSeconds?: number;
  /** Minimum quiet time after a run before the next one may start. */
  cooldownSeconds?: number;
  mode?: 'enforce' | 'off';
}

/**
 * Bot-side configuration, stored under the provider's `settings.botWake`. Everything is optional
 * and parsed defensively by {@link parseBotWakeSettings}: settings are user-edited JSON.
 */
export interface BotWakeConfig {
  classifier?: {
    initiateEnabled?: boolean;
    initiateThreshold?: number;
    mode?: WakePolicyMode;
    threshold?: number;
  };
  /** Free-text guidance for the classifier. */
  customInstructions?: string;
  /**
   * The settings switch for `customInstructions`. Off keeps the text but stops handing it to the
   * classifier; absent (a config saved before the switch existed) counts as on.
   */
  customInstructionsEnabled?: boolean;
  enabled?: boolean;
  /**
   * Mode of the rule policies (internal rules and the owner's structured rules). `off` disables
   * the scenario like `enabled: false`. Defaults to `shadow`.
   */
  mode?: WakePolicyMode;
  /**
   * How often the bot speaks up on its own (`calm` / `balanced` / `active`), or `custom` to read
   * `rules` and `scheduler` as written. Absent reads as `custom`.
   */
  pace?: 'active' | 'balanced' | 'calm' | 'custom';
  /**
   * Whether the bot may step in on its own when the owner raises something it can help with.
   * `enabled` is the settings switch (on = `enforce`); `mode` is an operator override, such as
   * `shadow` to only score it. On by default.
   */
  proactive?: { enabled?: boolean; mode?: WakePolicyMode; threshold?: number };
  rules?: Partial<Omit<WakeRules, 'classifier' | 'customInstructions' | 'proactive'>>;
  scheduler?: WakeSchedulerConfig;
}
