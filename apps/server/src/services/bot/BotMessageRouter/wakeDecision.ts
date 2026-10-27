import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import {
  botWakeClassifierCounter,
  botWakeClassifierDurationHistogram,
  botWakeDecisionCounter,
  botWakeFailureCounter,
  botWakeRecordDurationHistogram,
  botWakeVerdictCounter,
} from '@lobechat/observability-otel/modules/bot-wake';
import type { BotWakeKind, SignalDecisionVerdict } from '@lobechat/types';
import debug from 'debug';

import type { LobeChatDatabase } from '@/database/type';
import { recordSignalDecision } from '@/server/services/agentSignal/persistence/recordDecision';
import { aggregateWakeVerdictsAsync } from '@/server/services/agentSignal/scenarios/botWake/aggregator';
import { parseBotWakeSettings } from '@/server/services/agentSignal/scenarios/botWake/config';
import {
  CONVERSATION_PROMPT_LINES,
  discordMessageTime,
  toConversationLine,
} from '@/server/services/agentSignal/scenarios/botWake/conversation';
import {
  judgeExplicitMention,
  resolveChannelKeys,
  resolveConversationLogKey,
  wakeStateKeys,
} from '@/server/services/agentSignal/scenarios/botWake/facts';
import { isBotWakeEnabled } from '@/server/services/agentSignal/scenarios/botWake/gate';
import type {
  WakeClassify,
  WakeDutyJudge,
} from '@/server/services/agentSignal/scenarios/botWake/policies';
import {
  CLASSIFIER_POLICY_ID,
  createDutyPolicy,
  createWakePolicySet,
  DUTY_POLICY_ID,
} from '@/server/services/agentSignal/scenarios/botWake/policies';
import { createBotWakeRolloutProbe } from '@/server/services/agentSignal/scenarios/botWake/rollout';
import type {
  BotWakeConfig,
  WakeChannelState,
  WakeConversation,
  WakeConversationLine,
  WakeDecision,
  WakePolicy,
  WakeSignal,
  WakeStateSnapshot,
} from '@/server/services/agentSignal/scenarios/botWake/types';
import { redisService } from '@/server/services/redis';
import type { BotWakeChannelFields } from '@/server/services/redis/botWake';

import { getOriginMessageId, isReplayMessage } from '../mergeMessages';
import { buildWakeSignal, type WakeMessageLike } from '../wake/signal';

const log = debug('lobe-server:bot:wake-decision');

/** Revision of the bot-wake pipeline recorded on every decision. Bump when the judgement changes. */
export const BOT_WAKE_PIPELINE_VERSION = 'bot-wake@2';

/** Policy id the router's own, pre-existing wake judgement is recorded under. */
export const LEGACY_ROUTER_POLICY_ID = 'legacy-router';

/** Longest message text stored in a signal payload. */
const MAX_PAYLOAD_TEXT_LENGTH = 4000;

/** Classifier calls one bot may make per UTC hour; past it the policy records a degraded pass. */
export const CLASSIFIER_CALLS_PER_HOUR = 300;

/** Which inbound handler saw the message. */
export type BotWakeEntryPoint = 'catchAll' | 'onNewMention' | 'onSubscribedMessage';

/**
 * Why the router woke the bot, or why it did not. Mirrors the branches the handlers already take;
 * recording them adds no new branch.
 *
 * Stored as a plain string (`finalReason`), so rows written for a reason that no longer exists
 * (`classifier-confident`, `proactive-help`) stay readable; this build only stops writing them.
 */
export type BotWakeReason =
  | 'access-gate-rejected'
  | 'addressed'
  | 'command'
  | 'direct-message'
  | 'explicit-mention'
  | 'followup-window'
  | 'in-duty'
  | 'monitoring-not-allowed'
  | 'named-in-text'
  | 'not-addressed'
  | 'policy-denied'
  | 'scheduled'
  | 'solo-conversation'
  | 'watch-keyword';

/**
 * Whether a wake may end in silence, for every reason the router records. Only a wake nobody asked
 * for with an @ — a watch keyword in a thread the bot was not addressed in, its name in the text,
 * a message inside the follow-up window, or one within its duties — is `followup`. A DM, @mention, command, or a 1:1 that
 * reads as private is a direct address and keeps the always-answer behaviour.
 *
 * A table, not a list of the followups: a new reason does not compile until it says which it is.
 */
const KIND_BY_REASON: Record<BotWakeReason, BotWakeKind> = {
  'access-gate-rejected': 'mention',
  'addressed': 'mention',
  'command': 'mention',
  'direct-message': 'mention',
  'explicit-mention': 'mention',
  'followup-window': 'followup',
  'in-duty': 'followup',
  'monitoring-not-allowed': 'mention',
  'named-in-text': 'followup',
  'not-addressed': 'mention',
  'policy-denied': 'mention',
  'scheduled': 'mention',
  'solo-conversation': 'mention',
  'watch-keyword': 'followup',
};

export const botWakeKindFor = (reason: BotWakeReason): BotWakeKind => KIND_BY_REASON[reason];

const TAG_BY_REASON: Record<BotWakeReason, string> = {
  'access-gate-rejected': 'blocked',
  'addressed': 'addressed',
  'command': 'command',
  'direct-message': 'dm',
  'explicit-mention': 'mention',
  'followup-window': 'followup',
  'in-duty': 'duty',
  'monitoring-not-allowed': 'blocked',
  'named-in-text': 'named',
  'not-addressed': 'ignored',
  'policy-denied': 'blocked',
  'scheduled': 'scheduled',
  'solo-conversation': 'solo',
  'watch-keyword': 'keyword',
};

export interface BotWakeObservation {
  entryPoint: BotWakeEntryPoint;
  /** Verdicts of steps after the wake decision itself, such as how the reply was opened. */
  extraVerdicts?: SignalDecisionVerdict[];
  /** The message as the handler saw it (merged text when the bot was woken). */
  message: WakeMessageLike;
  outcome: 'defer' | 'skip' | 'wake';
  reason: BotWakeReason;
  threadId: string;
  /** The bot subscribed to the thread before this message arrived. */
  threadSubscribed?: boolean;
}

/** The channel state the recorder reads and writes; Redis in production, a fake in tests. */
export interface WakeStatePort {
  countClassifierCall: (applicationId: string, utcHour: string) => Promise<number | undefined>;
  readChannel: (keys: readonly string[]) => Promise<BotWakeChannelFields | undefined>;
  /** The wake `rememberInitiation` stored for a message; `undefined` when none or unreadable. */
  readInitiation?: (applicationId: string, messageId: string) => Promise<string | undefined>;
  /** The newest `limit` messages of a conversation, oldest first, without `excludeId`. */
  readRecentMessages?: (
    key: string,
    limit: number,
    excludeId?: string,
  ) => Promise<WakeConversationLine[] | undefined>;
  recordOwnerSpoke: (keys: readonly string[], at: number) => Promise<void>;
  /** Remembers whose message woke the bot, on the conversation's own key. */
  recordWakeAuthor?: (key: string, authorId: string) => Promise<void>;
  /** Keeps the wake decided for a message until its replay. */
  rememberInitiation?: (applicationId: string, messageId: string, value: string) => Promise<void>;
  /** Adds messages to the shared log of every key given. */
  rememberMessages?: (
    keys: readonly string[],
    lines: readonly WakeConversationLine[],
  ) => Promise<void>;
}

/** How many of a conversation's newest messages are read to find the bot's last words. */
const CONVERSATION_READ_LINES = 50;

/** The reasons `initiate` can wake the bot for. */
export type BotWakeInitiationReason = Extract<
  BotWakeReason,
  'followup-window' | 'in-duty' | 'named-in-text'
>;

/**
 * What each way of starting a wake on its own means for how the wake is handled.
 *
 * - `addressed`: the message is meant for the bot (it says the bot's name), so it is answered at
 *   once like an @mention. The scheduler's collect window is for merging a burst of chatter nobody
 *   addressed; making someone who called the bot wait for it only makes the bot look dead.
 *
 * Declared here, where the reason is decided, and read by the handlers as a fact about the
 * initiation: a new reason does not compile until it says what it is, and no call site has to
 * remember to list it.
 */
const INITIATION_TRAITS: Record<BotWakeInitiationReason, { addressed: boolean }> = {
  'followup-window': { addressed: false },
  // Nobody asked: it waits in the scheduler like any other unaddressed wake, and may end in silence.
  'in-duty': { addressed: false },
  'named-in-text': { addressed: true },
};

/** A wake the recorder started on its own: the rule that started it, and what that implies. */
export interface BotWakeInitiation {
  /** See {@link INITIATION_TRAITS}. */
  addressed: boolean;
  /** `in-duty` only: the duty the message falls within, when the judge named one. */
  duty?: string;
  reason: BotWakeInitiationReason;
}

const initiationFor = (reason: BotWakeInitiationReason, duty?: string): BotWakeInitiation => ({
  ...INITIATION_TRAITS[reason],
  ...(duty && { duty }),
  reason,
});

export interface BotWakeRecorderOptions {
  agentId: string;
  applicationId: string;
  /**
   * What people call this bot in a conversation (its display names, and its nickname in that
   * server), so a message that says one is read as addressed to it. Called lazily and only when a
   * message needs judging.
   */
  botNames?: (platformThreadId: string) => Promise<readonly string[]>;
  /** Bot-side config that gates the scenario's shadow policies. */
  botWakeConfig?: BotWakeConfig | null;
  /** Model call for the classifier policy; without it the classifier is not evaluated. */
  classify?: WakeClassify;
  db: LobeChatDatabase;
  /**
   * Model call for the duty policy (a message nobody addressed to the bot that falls within its
   * duties); without it, without duties, or with `botWake.duties.mode` off, the bot never steps in
   * on its own.
   */
  dutyJudge?: WakeDutyJudge;
  /**
   * Who the bot's agent is and what the owner is called, so the classifier can tell the assistant
   * from the person who set it up. Called lazily; the loader is expected to cache.
   */
  identity?: () => Promise<{
    agentName?: string;
    agentTitle?: string;
    ownerNames?: readonly string[];
  }>;
  /**
   * Watch keywords the owner marked as names the bot answers to (`asName`: "canis", "倏昱"). Read
   * as names wherever `botNames` are, and kept when the platform lookup fails.
   */
  nameKeywords?: readonly string[];
  /** The bot owner's user id on this platform (`settings.userId`). */
  operatorUserId?: string;
  platform: string;
  /**
   * Whether the `bot_wake` rollout flag is on for this bot's owner. Defaults to the runtime
   * feature flag; injectable for tests. Off means the recorder does nothing at all.
   */
  rollout?: () => Promise<boolean>;
  /** Raw provider settings (`botWake` is parsed from them). Overrides `botWakeConfig` rules. */
  settings?: Record<string, unknown> | null;
  /** Replaces the policy set built from `settings`. */
  shadowPolicies?: readonly WakePolicy[];
  state?: WakeStatePort;
  userId: string;
  workspaceId?: string;
}

/**
 * Records the router's wake decisions through the bot-wake scenario. Observation only: the
 * handlers decide exactly as they did before and this runs afterwards, off the request path.
 */
export interface BotWakeRecorder {
  /**
   * The conversation as a judgement sees it: the bot's names, its agent and owner, and the recent
   * lines of the shared log. Never throws; `undefined` when nothing is known.
   */
  conversation: (observation: BotWakeObservation) => Promise<WakeConversation | undefined>;
  /**
   * Decides whether to wake the bot for a message nobody addressed to it. The internal and owner
   * rules start a wake only when the owner switched them to `enforce`; the duty judge only when
   * the bot has duties and its own mode is `enforce` (it scores in `shadow`, and is not built when
   * `off` or without duties).
   *
   * Returns:
   * - `{ reason: 'named-in-text', addressed: true }` when the text calls the bot by name (no model
   *   call)
   * - `{ reason: 'followup-window', addressed: false }` when the bot spoke lately and an enforcing
   *   classifier agrees (a shadow or absent classifier does not stand in the way)
   * - `{ reason: 'in-duty', addressed: false, duty }` when the message, whoever wrote it, falls
   *   within the bot's duties: no rule had an opinion, and the enforcing duty judge scored it over
   *   its threshold. `duty` is the duty it named
   * - `undefined` for everything else, including a degraded classifier and any failure
   *
   * The evaluation is remembered, so the `record()` that follows does not judge the message again.
   */
  initiate: (observation: BotWakeObservation) => Promise<BotWakeInitiation | undefined>;
  /**
   * The `bot_wake` rollout flag for this bot's owner. Callers that change behaviour on their own
   * (follow-up wakes that may end in silence, the follow-up gate) must ask this first.
   */
  isRolledOut: () => Promise<boolean>;
  /**
   * Evaluates the policies that the owner switched to `enforce`, with their real modes.
   *
   * Returns:
   * - `undefined` when nothing is enforcing (the default: every policy shadows), so the caller
   *   changes nothing. Otherwise the decision; a `deny` means the follow-up wake must not run.
   *   Never throws: a failure is `undefined`.
   */
  judge: (observation: BotWakeObservation) => Promise<WakeDecision | undefined>;
  /** Fire-and-forget. Never throws and never rejects; a failed write is logged and dropped. */
  record: (observation: BotWakeObservation) => void;
  /**
   * Adds a person's message to the channel's shared log, so a later judgement can read what was
   * said around it. Never throws. Does nothing for the bot's own messages, direct messages, or
   * while the rollout or bot-wake is off.
   */
  remember: (observation: BotWakeObservation) => Promise<void>;
}

const asShadow = (policy: WakePolicy): WakePolicy => ({ ...policy, mode: 'shadow' });

const ruleVerdicts = (decision: WakeDecision): SignalDecisionVerdict[] =>
  decision.records.map((record) => ({
    confidence: record.confidence,
    latencyMs: record.latencyMs,
    mode: record.mode,
    policyId: record.policyId,
    reason: record.reason,
    verdict: record.verdict,
    version: record.policyVersion,
  }));

/**
 * Builds the verdict list for one observation: the router's own judgement first, then whatever the
 * scenario's shadow policies said.
 */
export const buildWakeVerdicts = async (
  observation: BotWakeObservation,
  signal: WakeSignal,
  shadowPolicies: readonly WakePolicy[],
  runShadow: boolean,
  state?: WakeChannelState,
  conversation?: WakeConversation,
  evaluated?: readonly SignalDecisionVerdict[],
): Promise<SignalDecisionVerdict[]> => {
  const verdicts: SignalDecisionVerdict[] = [
    {
      confidence: 1,
      latencyMs: 0,
      mode: 'enforce',
      policyId: LEGACY_ROUTER_POLICY_ID,
      reason: observation.reason,
      verdict:
        observation.outcome === 'wake'
          ? 'allow'
          : observation.outcome === 'defer'
            ? 'abstain'
            : 'deny',
      version: 1,
    },
  ];

  // The policies already ran for this message (`initiate`): reuse the answers, do not ask again.
  if (evaluated) return [...verdicts, ...evaluated];
  if (!runShadow || shadowPolicies.length === 0) return verdicts;

  const decision = await aggregateWakeVerdictsAsync(
    shadowPolicies.map(asShadow),
    signal,
    buildSnapshot(observation, signal, state, conversation),
  );

  return [...verdicts, ...ruleVerdicts(decision)];
};

const buildSnapshot = (
  observation: BotWakeObservation,
  signal: WakeSignal,
  channel?: WakeChannelState,
  conversation?: WakeConversation,
): WakeStateSnapshot => ({
  channel,
  conversation,
  // The adapter's flag, minus the broadcast pings it counts as mentions (Discord).
  explicitMention: judgeExplicitMention(observation.message.isMention === true, signal.mentions),
  replyToBot: false,
  threadSubscribed: observation.threadSubscribed === true,
});

const toChannelState = (fields: BotWakeChannelFields | undefined): WakeChannelState | undefined =>
  fields && {
    botLastSpokeAt: fields.botLastSpokeAt,
    followupAuthorId: fields.followupAuthorId,
    followupUntil: fields.followupUntil,
    ownerLastSpokeAt: fields.ownerLastSpokeAt,
    silentWakes: fields.silentWakes,
  };

/**
 * What a decision row keeps of the conversation. Names and counts only: other people's words stay
 * in the short-lived log and are not copied into a row that outlives the retention sweep.
 */
const summarizeConversation = (conversation?: WakeConversation) =>
  conversation && {
    botNames: conversation.botNames,
    hasLastBotMessage: conversation.lastBotMessage !== undefined,
    recentCount: conversation.recent.length,
  };

/** The wake decided for a parked message, as kept for its replay. */
interface RememberedInitiation {
  /** See {@link BotWakeInitiation.duty}. */
  duty?: string;
  reason: BotWakeInitiationReason;
  verdicts: SignalDecisionVerdict[];
}

const isInitiationReason = (value: unknown): value is BotWakeInitiationReason =>
  typeof value === 'string' && value in INITIATION_TRAITS;

/**
 * A stored decision, or `undefined` for none, a malformed one, or a reason this build lacks (one
 * kept by an earlier build, such as `proactive-help`: the replay is judged again).
 */
const parseRemembered = (raw: string | undefined): RememberedInitiation | undefined => {
  if (!raw) return;
  try {
    const value = JSON.parse(raw) as Partial<RememberedInitiation>;
    if (!isInitiationReason(value.reason)) return;

    return {
      duty: typeof value.duty === 'string' ? value.duty : undefined,
      reason: value.reason,
      verdicts: Array.isArray(value.verdicts) ? value.verdicts : [],
    };
  } catch {
    return;
  }
};

/** What `initiate` worked out, kept until the `record()` of the same message reuses it. */
interface Evaluation {
  channel?: WakeChannelState;
  conversation?: WakeConversation;
  /** Verdicts of the policies it ran; absent when it stopped before any could allow. */
  verdicts?: SignalDecisionVerdict[];
}

const MAX_PENDING_EVALUATIONS = 200;

const utcHour = (at: number) => new Date(at).toISOString().slice(0, 13);

export const createBotWakeRecorder = (options: BotWakeRecorderOptions): BotWakeRecorder => {
  const { agentId, applicationId, db, operatorUserId, platform, userId, workspaceId } = options;
  const scopeKey = `${platform}:${applicationId}`;
  const state: WakeStatePort = options.state ?? redisService.botWake;
  const parsed = parseBotWakeSettings(
    options.settings ?? (options.botWakeConfig ? { botWake: options.botWakeConfig } : undefined),
  );
  const enabled = isBotWakeEnabled(options.botWakeConfig ?? parsed.config);

  // Spend bound: a busy channel must not turn every message into a model call. The addressed
  // classifier and the duty judge share one hourly budget.
  const budgeted =
    <TInput, TOutput>(call: (input: TInput, abortSignal: AbortSignal) => Promise<TOutput>) =>
    async (input: TInput, abortSignal: AbortSignal): Promise<TOutput> => {
      const calls = await state.countClassifierCall(applicationId, utcHour(Date.now()));
      if (calls === undefined || calls > CLASSIFIER_CALLS_PER_HOUR) {
        botWakeClassifierCounter.add(1, { result: 'budget' });
        throw new Error('classifier-budget');
      }

      const startedAt = Date.now();
      try {
        const answer = await call(input, abortSignal);
        botWakeClassifierCounter.add(1, { result: 'ok' });

        return answer;
      } catch (error) {
        botWakeClassifierCounter.add(1, {
          result:
            abortSignal?.aborted || (error as Error)?.name === 'AbortError' ? 'timeout' : 'error',
        });
        throw error;
      } finally {
        botWakeClassifierDurationHistogram.record(Date.now() - startedAt);
      }
    };

  const classify: WakeClassify | undefined = options.classify && budgeted(options.classify);

  // Only duties the owner wrote turn it on; `initiate` is the one place it runs.
  const dutyPolicy =
    options.dutyJudge && parsed.rules.duties.text && parsed.rules.duties.mode !== 'off'
      ? createDutyPolicy(parsed.rules, budgeted(options.dutyJudge))
      : undefined;

  const rolledOut = options.rollout ?? createBotWakeRolloutProbe(userId);

  const policies =
    options.shadowPolicies ?? createWakePolicySet({ classify, settings: options.settings });

  /** `observedAt` is when the handler saw the message, not when this ran: a slow flag read must not shift event time. */
  const signalFor = (observation: BotWakeObservation, observedAt: number): WakeSignal =>
    buildWakeSignal({
      agentId,
      applicationId,
      message: { ...observation.message, text: observation.message.text ?? '' },
      operatorUserId,
      platform,
      platformThreadId: observation.threadId,
      timestamp: observedAt,
    });

  const readState = async (signal: WakeSignal) =>
    toChannelState(await state.readChannel(wakeStateKeys(signal.channelKeys!)));

  // Direct messages are private: only guild channels keep a shared log.
  const logKeyFor = (observation: BotWakeObservation): string | undefined =>
    platform === 'discord' && observation.threadId.split(':')[1] !== '@me'
      ? resolveConversationLogKey(platform, observation.threadId)
      : undefined;

  // No cache here: the platform client owns the names and refreshes them on its own schedule, so
  // a renamed bot answers to the new name and stops answering to the old one. A failed lookup is
  // retried on the next message.
  const nameKeywords = options.nameKeywords ?? [];
  const resolveBotNames = async (platformThreadId: string): Promise<readonly string[]> => {
    try {
      return [...((await options.botNames?.(platformThreadId)) ?? []), ...nameKeywords];
    } catch (error) {
      log('bot name lookup failed: %O', error);

      return nameKeywords;
    }
  };

  const resolveIdentity = async () => {
    try {
      return (await options.identity?.()) ?? {};
    } catch (error) {
      // Without an identity the classifier still judges, from the bot's names and the transcript.
      log('identity lookup failed: %O', error);

      return {};
    }
  };

  const readConversation = async (
    observation: BotWakeObservation,
  ): Promise<WakeConversation | undefined> => {
    const logKey = logKeyFor(observation);
    const [botNames, identity, lines] = await Promise.all([
      resolveBotNames(observation.threadId),
      resolveIdentity(),
      logKey && state.readRecentMessages
        ? state.readRecentMessages(logKey, CONVERSATION_READ_LINES, observation.message.id)
        : undefined,
    ]);
    const hasIdentity = !!(
      identity.agentName ||
      identity.agentTitle ||
      identity.ownerNames?.length
    );
    if (botNames.length === 0 && !lines && !hasIdentity) return;

    const recent = lines ?? [];
    const lastBotLine = recent.findLast((line) => line.isBot && line.authorId === applicationId);

    // The owner is known by their LobeHub name, and by whatever they go by on the platform: the
    // name on their earlier lines and on the message being judged.
    const { author } = observation.message;
    const platformNames = [
      ...recent
        .filter((line) => operatorUserId !== undefined && line.authorId === operatorUserId)
        .map((line) => line.authorName),
      ...(operatorUserId !== undefined && author?.userId === operatorUserId
        ? [author.userName, author.fullName]
        : []),
    ];
    const ownerNames = [
      ...new Set(
        [...(identity.ownerNames ?? []), ...platformNames]
          .map((name) => name?.trim())
          .filter((name): name is string => !!name),
      ),
    ];

    return {
      agent:
        identity.agentName || identity.agentTitle
          ? { name: identity.agentName, title: identity.agentTitle }
          : undefined,
      botNames: [...botNames],
      lastBotMessage: lastBotLine?.text,
      ownerId: operatorUserId,
      ownerNames: ownerNames.length > 0 ? ownerNames : undefined,
      recent: recent.slice(-CONVERSATION_PROMPT_LINES),
    };
  };

  const evaluations = new Map<string, Evaluation>();
  // By channel, not thread: a Discord wake opens its reply thread after `initiate` and before
  // `record()`, so the same message is recorded under the new thread's id. Keyed by thread, the
  // evaluation was missed and the policies ran again on the new thread's empty log.
  const evaluationKey = (observation: BotWakeObservation) =>
    `${resolveChannelKeys(platform, applicationId, observation.threadId).channelKey}:${observation.message.id}`;
  const keepEvaluation = (observation: BotWakeObservation, evaluation: Evaluation) => {
    evaluations.set(evaluationKey(observation), evaluation);
    // A message that is never recorded must not pile up.
    if (evaluations.size > MAX_PENDING_EVALUATIONS) {
      evaluations.delete(evaluations.keys().next().value!);
    }
  };
  const takeEvaluation = (observation: BotWakeObservation) => {
    const key = evaluationKey(observation);
    const evaluation = evaluations.get(key);
    evaluations.delete(key);

    return evaluation;
  };

  /**
   * Starts a wake: keeps the evaluation for the `record()` that follows, and remembers the decision
   * under the message's platform id so a replay of the parked message runs on it.
   */
  const initiated = async (
    observation: BotWakeObservation,
    reason: BotWakeInitiationReason,
    evaluation: Evaluation,
    duty?: string,
  ): Promise<BotWakeInitiation> => {
    keepEvaluation(observation, evaluation);
    await state.rememberInitiation?.(
      applicationId,
      getOriginMessageId(observation.message),
      JSON.stringify({
        duty,
        reason,
        verdicts: evaluation.verdicts ?? [],
      } satisfies RememberedInitiation),
    );

    return initiationFor(reason, duty);
  };

  /**
   * Asks the duty judge, after everything else declined: does the message, whoever wrote it, fall
   * within the bot's duties ("要是导出能保留文件夹结构就好了" for a bot that assesses feature
   * requests)? Adds its verdict to `evaluation` and keeps it for `record()`.
   */
  const judgeDuty = async (
    observation: BotWakeObservation,
    signal: WakeSignal,
    snapshot: WakeStateSnapshot,
    evaluation: Evaluation & { verdicts: SignalDecisionVerdict[] },
  ): Promise<BotWakeInitiation | undefined> => {
    if (!dutyPolicy) return;

    const judged = await aggregateWakeVerdictsAsync([dutyPolicy], signal, snapshot);
    evaluation.verdicts.push(...ruleVerdicts(judged));

    // A shadow judge only scores; a degraded one abstains, so it never lands here.
    if (dutyPolicy.mode === 'enforce' && judged.verdict === 'allow') {
      const record = judged.records.find((entry) => entry.policyId === DUTY_POLICY_ID);
      return initiated(observation, 'in-duty', evaluation, record?.matched);
    }

    keepEvaluation(observation, evaluation);
  };

  const persist = async (observation: BotWakeObservation, observedAt: number) => {
    // Rollout off: no row, no Redis write, no model call. The bot behaves as it did before.
    if (!(await rolledOut())) return;

    const startedAt = Date.now();
    const text = observation.message.text ?? '';
    const signal = signalFor(observation, observedAt);

    if (enabled && signal.author?.isOwner) {
      await state.recordOwnerSpoke(wakeStateKeys(signal.channelKeys!), signal.timestamp);
    }

    // Who the bot is about to answer: its reply opens the follow-up window on the same key (the
    // Discord thread it replies in), and only this person's next words follow up on it.
    if (enabled && observation.outcome === 'wake' && signal.author?.id) {
      const conversationKey = wakeStateKeys(signal.channelKeys!).at(-1);
      if (conversationKey) await state.recordWakeAuthor?.(conversationKey, signal.author.id);
    }

    // `initiate` may have read the state and run the policies already; do neither twice.
    const evaluated = takeEvaluation(observation);
    const channel = enabled ? (evaluated ? evaluated.channel : await readState(signal)) : undefined;
    const conversation = enabled
      ? evaluated
        ? evaluated.conversation
        : await readConversation(observation)
      : undefined;
    // The state the policies read, so the decision can be replayed and explained later.
    const snapshot = buildSnapshot(observation, signal, channel, conversation);
    const stateSnapshot = {
      ...snapshot,
      // Who wrote it, so a decision can be read without the purged payload: an id, not a name.
      author: signal.author && { id: signal.author.id, isOwner: signal.author.isOwner },
      conversation: summarizeConversation(conversation),
    };

    const verdicts = [
      ...(await buildWakeVerdicts(
        observation,
        { ...signal, message: text },
        policies,
        enabled,
        channel,
        conversation,
        evaluated?.verdicts,
      )),
      ...(observation.extraVerdicts ?? []),
    ];

    const recorded = await recordSignalDecision(db, {
      agentId,
      decision: {
        finalReason: observation.reason,
        metadata: { stateSnapshot },
        outcome: observation.outcome,
        pipelineVersion: BOT_WAKE_PIPELINE_VERSION,
        toTag: TAG_BY_REASON[observation.reason],
        verdicts,
      },
      scopeKey,
      signal: {
        // Telegram-style message ids repeat across chats, so the key carries the whole address.
        externalId: `${applicationId}:${observation.threadId}:${observation.message.id}`,
        // Where the event was addressed and which handler saw it are not content: they stay on the
        // row after the retention sweep blanks the payload.
        metadata: {
          address: {
            applicationId,
            messageId: observation.message.id,
            platform,
            platformThreadId: observation.threadId,
          },
          entryPoint: observation.entryPoint,
        },
        payload: { text: text.slice(0, MAX_PAYLOAD_TEXT_LENGTH) },
        source: `bot:${platform}`,
        sourceType: AGENT_SIGNAL_SOURCE_TYPES.botMessageMerged,
        type: AGENT_SIGNAL_SOURCE_TYPES.botMessageMerged,
      },
      userId,
      workspaceId,
    });

    botWakeRecordDurationHistogram.record(Date.now() - startedAt);
    if (!recorded.persisted) return;

    botWakeDecisionCounter.add(1, {
      entry_point: observation.entryPoint,
      outcome: observation.outcome,
      platform,
      reason: observation.reason,
      tag: TAG_BY_REASON[observation.reason],
    });
    for (const verdict of verdicts) {
      botWakeVerdictCounter.add(1, {
        mode: verdict.mode,
        policy_id: verdict.policyId,
        verdict: verdict.verdict,
      });
    }
  };

  return {
    conversation: async (observation) => {
      try {
        return await readConversation(observation);
      } catch (error) {
        log('conversation read failed: entry=%s %O', observation.entryPoint, error);
      }
    },
    isRolledOut: rolledOut,
    judge: async (observation) => {
      const observedAt = Date.now();
      try {
        if (!(await rolledOut())) return;

        // The classifier answers "is this talking to the bot?", which is the wrong question for a
        // keyword wake: the keyword is there to wake the bot without anyone addressing it. Only
        // the rules (scope, lists, budget, owner presence) may veto one; the classifier's score
        // for it is still recorded by `record()`.
        const vetoPolicies = policies.filter((policy) => policy.id !== CLASSIFIER_POLICY_ID);
        if (!enabled || !vetoPolicies.some((policy) => policy.mode === 'enforce')) return;

        const signal = signalFor(observation, observedAt);
        const [channel, conversation] = await Promise.all([
          readState(signal),
          readConversation(observation),
        ]);

        return await aggregateWakeVerdictsAsync(
          vetoPolicies,
          signal,
          buildSnapshot(observation, signal, channel, conversation),
        );
      } catch (error) {
        botWakeFailureCounter.add(1, { stage: 'judge' });
        log('judge failed: entry=%s %O', observation.entryPoint, error);
      }
    },
    initiate: async (observation) => {
      const observedAt = Date.now();
      try {
        if (!(await rolledOut()) || !enabled) return;

        const rulePolicies = policies.filter((policy) => policy.id !== CLASSIFIER_POLICY_ID);
        const rulesEnforce = rulePolicies.some((policy) => policy.mode === 'enforce');
        if (!rulesEnforce && !dutyPolicy) return;

        const signal = signalFor(observation, observedAt);
        const [channel, conversation] = await Promise.all([
          readState(signal),
          readConversation(observation),
        ]);
        const snapshot = buildSnapshot(observation, signal, channel, conversation);

        // A parked message's replay runs on the wake decided when it was parked. Judging it again
        // can flip a borderline score (0.51 then 0.13) and drop a message the bot already took.
        if (isReplayMessage(observation.message)) {
          const remembered = parseRemembered(
            await state.readInitiation?.(applicationId, getOriginMessageId(observation.message)),
          );
          if (remembered) {
            keepEvaluation(observation, { channel, conversation, verdicts: remembered.verdicts });

            return initiationFor(remembered.reason, remembered.duty);
          }
        }

        const ruleDecision = await aggregateWakeVerdictsAsync(rulePolicies, signal, snapshot);
        if (!rulesEnforce || ruleDecision.verdict !== 'allow' || ruleDecision.fastPath) {
          // Nothing addressed the bot and no rule allowed it: not named, outside the follow-up
          // window. Only when no rule had an opinion either way, whatever the rules' mode: a deny
          // (a channel list, the silent-wake budget) still keeps the bot out.
          const undecided =
            !ruleDecision.fastPath &&
            ruleDecision.records.every((record) => record.verdict === 'abstain');
          if (!undecided || !dutyPolicy) {
            // An enforcing deny is what kept the bot quiet: keep its verdicts, so the row names the
            // rule that stopped the wake instead of replaying every policy as if it only watched.
            keepEvaluation(observation, {
              channel,
              conversation,
              verdicts: ruleDecision.verdict === 'deny' ? ruleVerdicts(ruleDecision) : undefined,
            });
            return;
          }

          return await judgeDuty(observation, signal, snapshot, {
            channel,
            conversation,
            verdicts: ruleVerdicts(ruleDecision),
          });
        }

        const verdicts = ruleVerdicts(ruleDecision);
        const evaluation = { channel, conversation, verdicts };

        // Said by name: no need to ask a model whether it was meant for the bot.
        if (ruleDecision.reason === 'named-in-text') {
          return initiated(observation, 'named-in-text', evaluation);
        }

        // Only the window is open. A classifier the owner enforces must confirm; one that only
        // watches is scored for the record and does not stand in the way.
        const classifier = policies.find((policy) => policy.id === CLASSIFIER_POLICY_ID);
        if (classifier) {
          const classified = await aggregateWakeVerdictsAsync([classifier], signal, snapshot);
          verdicts.push(...ruleVerdicts(classified));
          keepEvaluation(observation, evaluation);

          // A classifier that failed or ran out of budget passes in `degraded`: when the owner
          // relies on it, no answer is not a yes. Not a follow-up to the bot, the message may still
          // fall within its duties.
          const degraded = classified.records.some((record) => record.tags.includes('degraded'));
          if (classifier.mode === 'enforce' && (classified.verdict !== 'allow' || degraded)) {
            return dutyPolicy
              ? await judgeDuty(observation, signal, snapshot, evaluation)
              : undefined;
          }
        }

        return initiated(observation, 'followup-window', evaluation);
      } catch (error) {
        botWakeFailureCounter.add(1, { stage: 'initiate' });
        log('initiate failed: entry=%s %O', observation.entryPoint, error);
      }
    },
    remember: async (observation) => {
      try {
        const logKey = logKeyFor(observation);
        const { message } = observation;
        if (!logKey || message.author?.isMe || !state.rememberMessages) return;
        if (!enabled || !(await rolledOut())) return;

        const line = toConversationLine({
          // A Discord id carries its send time, so two bots write the identical line.
          at: discordMessageTime(message.id) ?? Date.now(),
          authorId: message.author?.userId,
          authorName: message.author?.userName ?? message.author?.fullName,
          hasAttachments: (message.attachments?.length ?? 0) > 0,
          id: message.id,
          isBot: message.author?.isBot === true,
          text: message.text,
        });
        if (!line.text) return;

        await state.rememberMessages([logKey], [line]);
      } catch (error) {
        botWakeFailureCounter.add(1, { stage: 'remember' });
        log('remember failed: entry=%s %O', observation.entryPoint, error);
      }
    },
    record: (observation) => {
      const observedAt = Date.now();
      // `Promise.resolve().then` also catches a synchronous throw, so a malformed message can
      // never surface in the handler that called this.
      void Promise.resolve()
        .then(() => persist(observation, observedAt))
        .catch((error) => {
          botWakeFailureCounter.add(1, { stage: 'persist' });
          // Recording never changes what the bot does, so this is the only trace of a failure.
          console.error(
            `[bot-wake] record failed: entry=${observation.entryPoint} reason=${observation.reason}`,
            error,
          );
        });
    },
  };
};
