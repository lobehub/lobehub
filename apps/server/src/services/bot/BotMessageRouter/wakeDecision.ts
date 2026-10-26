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
  resolveConversationLogKey,
  wakeStateKeys,
} from '@/server/services/agentSignal/scenarios/botWake/facts';
import { isBotWakeEnabled } from '@/server/services/agentSignal/scenarios/botWake/gate';
import type { WakeClassify } from '@/server/services/agentSignal/scenarios/botWake/policies';
import {
  CLASSIFIER_POLICY_ID,
  createWakePolicySet,
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

import { buildWakeSignal, type WakeMessageLike } from '../wake/signal';

const log = debug('lobe-server:bot:wake-decision');

/** Revision of the bot-wake pipeline recorded on every decision. Bump when the judgement changes. */
export const BOT_WAKE_PIPELINE_VERSION = 'bot-wake@1';

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
 */
export type BotWakeReason =
  | 'access-gate-rejected'
  | 'addressed'
  | 'command'
  | 'direct-message'
  | 'explicit-mention'
  | 'followup-window'
  | 'monitoring-not-allowed'
  | 'named-in-text'
  | 'not-addressed'
  | 'policy-denied'
  | 'scheduled'
  | 'solo-conversation'
  | 'watch-keyword';

const FOLLOWUP_REASONS: ReadonlySet<BotWakeReason> = new Set([
  'followup-window',
  'named-in-text',
  'watch-keyword',
]);

/**
 * Whether a wake may end in silence. Only a wake nobody asked for with an @ — a watch keyword in a
 * thread the bot was not addressed in, its name in the text, or a message inside the follow-up
 * window — is `followup`. A DM, @mention, command, or a 1:1 that reads as private is a direct
 * address and keeps the always-answer behaviour.
 */
export const botWakeKindFor = (reason: BotWakeReason): BotWakeKind =>
  FOLLOWUP_REASONS.has(reason) ? 'followup' : 'mention';

const TAG_BY_REASON: Record<BotWakeReason, string> = {
  'access-gate-rejected': 'blocked',
  'addressed': 'addressed',
  'command': 'command',
  'direct-message': 'dm',
  'explicit-mention': 'mention',
  'followup-window': 'followup',
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
  /** The newest `limit` messages of a conversation, oldest first, without `excludeId`. */
  readRecentMessages?: (
    key: string,
    limit: number,
    excludeId?: string,
  ) => Promise<WakeConversationLine[] | undefined>;
  recordOwnerSpoke: (keys: readonly string[], at: number) => Promise<void>;
  /** Adds messages to the shared log of every key given. */
  rememberMessages?: (
    keys: readonly string[],
    lines: readonly WakeConversationLine[],
  ) => Promise<void>;
}

/** How many of a conversation's newest messages are read to find the bot's last words. */
const CONVERSATION_READ_LINES = 50;

/** A wake the recorder started on its own, and the rule that started it. */
export interface BotWakeInitiation {
  reason: Extract<BotWakeReason, 'followup-window' | 'named-in-text'>;
}

export interface BotWakeRecorderOptions {
  agentId: string;
  applicationId: string;
  /**
   * What people call this bot (its display names), so a message that says one is read as
   * addressed to it. Called lazily and only when a message needs judging.
   */
  botNames?: () => Promise<readonly string[]>;
  /** Bot-side config that gates the scenario's shadow policies. */
  botWakeConfig?: BotWakeConfig | null;
  /** Model call for the classifier policy; without it the classifier is not evaluated. */
  classify?: WakeClassify;
  db: LobeChatDatabase;
  /**
   * Who the bot's agent is and what the owner is called, so the classifier can tell the assistant
   * from the person who set it up. Called lazily; the loader is expected to cache.
   */
  identity?: () => Promise<{
    agentName?: string;
    agentTitle?: string;
    ownerNames?: readonly string[];
  }>;
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
   * Decides whether to wake the bot for a message nobody addressed to it. Only when the owner
   * switched the rules to `enforce`: the internal and owner rules then act as the initiator, not
   * only as a veto.
   *
   * Returns:
   * - `{ reason: 'named-in-text' }` when the text calls the bot by name (no model call)
   * - `{ reason: 'followup-window' }` when the bot spoke lately and an enforcing classifier agrees
   *   (a shadow or absent classifier does not stand in the way)
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

  // Spend bound: a busy channel must not turn every message into a model call.
  const classify: WakeClassify | undefined =
    options.classify &&
    (async (input, abortSignal) => {
      const calls = await state.countClassifierCall(applicationId, utcHour(Date.now()));
      if (calls === undefined || calls > CLASSIFIER_CALLS_PER_HOUR) {
        botWakeClassifierCounter.add(1, { result: 'budget' });
        throw new Error('classifier-budget');
      }

      const startedAt = Date.now();
      try {
        const answer = await options.classify!(input, abortSignal);
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
    });

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
  const resolveBotNames = async (): Promise<readonly string[]> => {
    try {
      return (await options.botNames?.()) ?? [];
    } catch (error) {
      log('bot name lookup failed: %O', error);

      return [];
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
      resolveBotNames(),
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
  const evaluationKey = (observation: BotWakeObservation) =>
    `${observation.threadId}:${observation.message.id}`;
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

  const persist = async (observation: BotWakeObservation, observedAt: number) => {
    // Rollout off: no row, no Redis write, no model call. The bot behaves as it did before.
    if (!(await rolledOut())) return;

    const startedAt = Date.now();
    const text = observation.message.text ?? '';
    const signal = signalFor(observation, observedAt);

    if (enabled && signal.author?.isOwner) {
      await state.recordOwnerSpoke(wakeStateKeys(signal.channelKeys!), signal.timestamp);
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
    const stateSnapshot = { ...snapshot, conversation: summarizeConversation(conversation) };

    const verdicts = await buildWakeVerdicts(
      observation,
      { ...signal, message: text },
      policies,
      enabled,
      channel,
      conversation,
      evaluated?.verdicts,
    );

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
    isRolledOut: rolledOut,
    judge: async (observation) => {
      const observedAt = Date.now();
      try {
        if (!(await rolledOut())) return;
        if (!enabled || !policies.some((policy) => policy.mode === 'enforce')) return;

        const signal = signalFor(observation, observedAt);
        const [channel, conversation] = await Promise.all([
          readState(signal),
          readConversation(observation),
        ]);

        return await aggregateWakeVerdictsAsync(
          policies,
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
        if (!rulePolicies.some((policy) => policy.mode === 'enforce')) return;

        const signal = signalFor(observation, observedAt);
        const [channel, conversation] = await Promise.all([
          readState(signal),
          readConversation(observation),
        ]);
        const snapshot = buildSnapshot(observation, signal, channel, conversation);

        const ruleDecision = await aggregateWakeVerdictsAsync(rulePolicies, signal, snapshot);
        if (ruleDecision.verdict !== 'allow' || ruleDecision.fastPath) {
          keepEvaluation(observation, { channel, conversation });
          return;
        }

        const verdicts = ruleVerdicts(ruleDecision);
        const evaluation = { channel, conversation, verdicts };

        // Said by name: no need to ask a model whether it was meant for the bot.
        if (ruleDecision.reason === 'named-in-text') {
          keepEvaluation(observation, evaluation);

          return { reason: 'named-in-text' };
        }

        // Only the window is open. A classifier the owner enforces must confirm; one that only
        // watches is scored for the record and does not stand in the way.
        const classifier = policies.find((policy) => policy.id === CLASSIFIER_POLICY_ID);
        if (classifier) {
          const classified = await aggregateWakeVerdictsAsync([classifier], signal, snapshot);
          verdicts.push(...ruleVerdicts(classified));
          keepEvaluation(observation, evaluation);

          // A classifier that failed or ran out of budget passes in `degraded`: when the owner
          // relies on it, no answer is not a yes.
          const degraded = classified.records.some((record) => record.tags.includes('degraded'));
          if (classifier.mode === 'enforce' && (classified.verdict !== 'allow' || degraded)) return;
        } else {
          keepEvaluation(observation, evaluation);
        }

        return { reason: 'followup-window' };
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
