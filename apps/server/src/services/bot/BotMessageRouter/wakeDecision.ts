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
  judgeExplicitMention,
  wakeStateKeys,
} from '@/server/services/agentSignal/scenarios/botWake/facts';
import { isBotWakeEnabled } from '@/server/services/agentSignal/scenarios/botWake/gate';
import type { WakeClassify } from '@/server/services/agentSignal/scenarios/botWake/policies';
import { createWakePolicySet } from '@/server/services/agentSignal/scenarios/botWake/policies';
import { createBotWakeRolloutProbe } from '@/server/services/agentSignal/scenarios/botWake/rollout';
import type {
  BotWakeConfig,
  WakeChannelState,
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
  | 'monitoring-not-allowed'
  | 'not-addressed'
  | 'policy-denied'
  | 'scheduled'
  | 'solo-conversation'
  | 'watch-keyword';

/**
 * Whether a wake may end in silence. Only a wake nobody asked for — today a watch keyword in a
 * thread the bot was not addressed in — is `followup`. A DM, @mention, command, or a 1:1 that
 * reads as private is a direct address and keeps the always-answer behaviour.
 */
export const botWakeKindFor = (reason: BotWakeReason): BotWakeKind =>
  reason === 'watch-keyword' ? 'followup' : 'mention';

const TAG_BY_REASON: Record<BotWakeReason, string> = {
  'access-gate-rejected': 'blocked',
  'addressed': 'addressed',
  'command': 'command',
  'direct-message': 'dm',
  'explicit-mention': 'mention',
  'monitoring-not-allowed': 'blocked',
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
  recordOwnerSpoke: (keys: readonly string[], at: number) => Promise<void>;
}

export interface BotWakeRecorderOptions {
  agentId: string;
  applicationId: string;
  /** Bot-side config that gates the scenario's shadow policies. */
  botWakeConfig?: BotWakeConfig | null;
  /** Model call for the classifier policy; without it the classifier is not evaluated. */
  classify?: WakeClassify;
  db: LobeChatDatabase;
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

  if (!runShadow || shadowPolicies.length === 0) return verdicts;

  const decision = await aggregateWakeVerdictsAsync(
    shadowPolicies.map(asShadow),
    signal,
    buildSnapshot(observation, signal, state),
  );

  return [...verdicts, ...ruleVerdicts(decision)];
};

const buildSnapshot = (
  observation: BotWakeObservation,
  signal: WakeSignal,
  channel?: WakeChannelState,
): WakeStateSnapshot => ({
  channel,
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
          result: abortSignal?.aborted || (error as Error)?.name === 'AbortError' ? 'timeout' : 'error',
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

  const persist = async (observation: BotWakeObservation, observedAt: number) => {
    // Rollout off: no row, no Redis write, no model call. The bot behaves as it did before.
    if (!(await rolledOut())) return;

    const startedAt = Date.now();
    const text = observation.message.text ?? '';
    const signal = signalFor(observation, observedAt);

    if (enabled && signal.author?.isOwner) {
      await state.recordOwnerSpoke(wakeStateKeys(signal.channelKeys!), signal.timestamp);
    }

    const channel = enabled ? await readState(signal) : undefined;
    // The state the policies read, so the decision can be replayed and explained later.
    const stateSnapshot = { ...buildSnapshot(observation, signal, channel) };

    const verdicts = await buildWakeVerdicts(
      observation,
      { ...signal, message: text },
      policies,
      enabled,
      channel,
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

        return await aggregateWakeVerdictsAsync(
          policies,
          signal,
          buildSnapshot(observation, signal, await readState(signal)),
        );
      } catch (error) {
        botWakeFailureCounter.add(1, { stage: 'judge' });
        log('judge failed: entry=%s %O', observation.entryPoint, error);
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
