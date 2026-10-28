import { botWakeFlushCounter } from '@lobechat/observability-otel/modules/bot-wake';
import { BOT_STAND_DOWN_MINUTES } from '@lobechat/types';
import debug from 'debug';

import { appEnv } from '@/envs/app';
import { parseBotWakeSettings } from '@/server/services/agentSignal/scenarios/botWake/config';
import { toConversationLine } from '@/server/services/agentSignal/scenarios/botWake/conversation';
import {
  resolveChannelKeys,
  resolveConversationLogKeys,
  wakeStateKeys,
} from '@/server/services/agentSignal/scenarios/botWake/facts';
import { isBotWakeEnabled } from '@/server/services/agentSignal/scenarios/botWake/gate';
import { createBotWakeRolloutProbe } from '@/server/services/agentSignal/scenarios/botWake/rollout';
import type { SchedulerOptions } from '@/server/services/agentSignal/scenarios/botWake/scheduler';
import { WakeScheduler } from '@/server/services/agentSignal/scenarios/botWake/scheduler';
import { QueueService } from '@/server/services/queue';
import { LocalQueueServiceImpl } from '@/server/services/queue/impls';
import { redisService } from '@/server/services/redis';
import { agentSignalScopeFlowControl } from '@/server/workflows/agentSignal';

import { runDeferredReplay } from '../deferredReplay';

const log = debug('lobe-server:bot:wake-scheduler');

export const WAKE_FLUSH_ENDPOINT = '/api/agent/webhooks/bot-wake-flush';

/** What the delayed flush carries back: enough to find the scheduler and replay the batch. */
export interface WakeFlushPayload {
  applicationId: string;
  at: number;
  channelKey: string;
  platform: string;
}

export interface WakeSchedulerTarget {
  applicationId: string;
  options: Omit<SchedulerOptions, 'runLeaseMs'>;
  platform: string;
}

/**
 * The delay queue for the scheduler is the job queue (QStash), which survives a restart. The
 * local, in-process queue is deliberately not used: an unfired timer would be lost, so without
 * a real queue the scheduler is unavailable and follow-up wakes stay immediate.
 */
export const isWakeSchedulerAvailable = (): boolean => !new QueueService().isLocalExecution();

/**
 * Builds the scheduler for one bot, or `undefined` when no delay queue is configured.
 */
export const createWakeScheduler = ({
  applicationId,
  options,
  platform,
}: WakeSchedulerTarget): WakeScheduler | undefined => {
  const queue = new QueueService();
  if (queue.getImpl() instanceof LocalQueueServiceImpl) return;

  const baseURL = process.env.AGENT_RUNTIME_BASE_URL || appEnv.APP_URL || 'http://localhost:3010';

  return new WakeScheduler({
    delayQueue: {
      scheduleFlush: async ({ at, channelKey }) => {
        const payload: WakeFlushPayload = { applicationId, at, channelKey, platform };

        await queue.scheduleMessage({
          deduplicationId: `bot-wake-flush:${channelKey}:${at}`,
          delay: Math.max(0, at - Date.now()),
          endpoint: new URL(WAKE_FLUSH_ENDPOINT, baseURL).toString(),
          // The same per-scopeKey serialization Agent Signal runs use: this channel's flushes
          // are delivered one at a time.
          flowControl: agentSignalScopeFlowControl(channelKey),
          operationId: `bot-wake:${channelKey}`,
          payload,
          retries: 3,
          stepIndex: 0,
        });
      },
    },
    options,
    startRun: async ({ channelKey, messageIds, runId, threadIds }) => {
      log('start run channel=%s run=%s messages=%d', channelKey, runId, messageIds.length);

      // One replay per thread the parked messages came from; each runs through the normal
      // inbound pipeline, where the scheduler lets the released batch pass.
      for (const platformThreadId of threadIds) {
        await runDeferredReplay({ applicationId, platform, platformThreadId });
      }
    },
    store: { mutate: (key, mutate) => redisService.botWake.mutateScheduler(key, mutate) },
  });
};

/**
 * Resolves the scheduler for a provider's settings: only when the bot has bot-wake enabled and
 * its scheduler switched to `enforce`.
 */
export const resolveWakeScheduler = (
  platform: string,
  applicationId: string,
  settings: Record<string, unknown> | null | undefined,
): WakeScheduler | undefined => {
  const { config, scheduler } = parseBotWakeSettings(settings);
  if (!isBotWakeEnabled(config) || scheduler.mode !== 'enforce') return;

  return createWakeScheduler({
    applicationId,
    options: { collectMs: scheduler.collectMs, cooldownMs: scheduler.cooldownMs },
    platform,
  });
};

/** The slice of a bot provider a flush needs: its settings and whose rollout flag applies. */
export interface WakeFlushProvider {
  settings?: Record<string, unknown> | null;
  userId: string;
}

/**
 * QStash delivered a flush. Re-reads the bot's settings, so a changed config applies at once.
 *
 * Nothing is replayed when the `bot_wake` rollout flag has been turned off since the messages
 * were parked: a parked follow-up nobody addressed to the bot would otherwise run as a plain
 * wake and be answered, which is the behaviour the flag exists to take away.
 */
export const handleWakeFlush = async (
  payload: WakeFlushPayload,
  loadProvider: (platform: string, applicationId: string) => Promise<WakeFlushProvider | undefined>,
  options: { rollout?: (userId: string) => Promise<boolean> } = {},
): Promise<void> => {
  const provider = await loadProvider(payload.platform, payload.applicationId);
  if (!provider) {
    botWakeFlushCounter.add(1, { result: 'no_provider' });
    return;
  }

  const rolledOut = options.rollout ?? ((userId: string) => createBotWakeRolloutProbe(userId)());
  if (!(await rolledOut(provider.userId))) {
    botWakeFlushCounter.add(1, { result: 'flag_off' });
    return;
  }

  const scheduler = resolveWakeScheduler(
    payload.platform,
    payload.applicationId,
    provider.settings,
  );

  // The owner turned the scheduler off or disabled the bot after messages were parked. Those
  // stay in the deferred-message store until it expires; nothing is run on a stale config.
  if (!scheduler) {
    botWakeFlushCounter.add(1, { result: 'no_scheduler' });
    return;
  }

  try {
    await scheduler.flush(payload.channelKey);
    botWakeFlushCounter.add(1, { result: 'flushed' });
  } catch (error) {
    botWakeFlushCounter.add(1, { result: 'failed' });
    throw error;
  }
};

/**
 * Adds the bot's own reply to the conversation log, so the next judgement can read what the bot
 * last said. Best-effort: a failed write never affects the run's bookkeeping. Discord guild
 * channels only, like the log itself.
 */
const rememberBotReply = async ({
  applicationId,
  at,
  platform,
  platformThreadId,
  spoken,
}: {
  applicationId: string;
  at: number;
  platform: string;
  platformThreadId: string;
  spoken?: { id: string; text?: string };
}) => {
  if (platform !== 'discord' || platformThreadId.split(':')[1] === '@me') return;

  try {
    const line = toConversationLine({
      at,
      authorId: applicationId,
      id: `bot:${spoken?.id ?? at}`,
      isBot: true,
      text: spoken?.text,
    });
    if (!line.text) return;

    await redisService.botWake.rememberMessages(
      resolveConversationLogKeys(platform, platformThreadId),
      [line],
    );
  } catch (error) {
    log('rememberBotReply failed: %O', error);
  }
};

/** Keys the bot's wake state is filed under for a conversation. */
export const wakeKeysFor = (platform: string, applicationId: string, platformThreadId: string) =>
  wakeStateKeys(resolveChannelKeys(platform, applicationId, platformThreadId));

/**
 * A run for this conversation finished. Updates the follow-up bookkeeping and frees the
 * scheduler's channel.
 *
 * Expects:
 * - Only called for bots with bot-wake enabled; everything else is a no-op the caller skips
 *
 * `spoke` = the bot posted a reply. A follow-up wake that ended in silence counts against the
 * silent-wake budget; speaking opens the follow-up window and resets it.
 *
 * `standDown` = the agent stepped back from the conversation (`STAND_DOWN`): for
 * `BOT_STAND_DOWN_MINUTES` only an explicit address wakes it there. Filed on the conversation's own
 * key, the thread the run replied in.
 */
export const recordWakeRunOutcome = async (input: {
  applicationId: string;
  platform: string;
  platformThreadId: string;
  settings: Record<string, unknown> | null | undefined;
  spoke: boolean;
  /** What the bot said and the id of the run that said it; kept in the channel's shared log. */
  spoken?: { id: string; text?: string };
  standDown?: boolean;
  wakeKind?: 'followup' | 'mention';
}): Promise<void> => {
  const {
    applicationId,
    platform,
    platformThreadId,
    settings,
    spoke,
    spoken,
    standDown,
    wakeKind,
  } = input;
  const { config, rules } = parseBotWakeSettings(settings);
  if (!isBotWakeEnabled(config)) return;

  const keys = wakeKeysFor(platform, applicationId, platformThreadId);

  if (spoke) {
    const at = Date.now();
    await redisService.botWake.recordBotSpoke(keys, at, rules.windowSeconds * 1000);
    await rememberBotReply({ applicationId, at, platform, platformThreadId, spoken });
  } else if (wakeKind === 'followup') {
    await redisService.botWake.recordSilentWake(keys);
  }

  const conversationKey = keys.at(-1);
  if (standDown && conversationKey) {
    await redisService.botWake.recordStandDown(
      conversationKey,
      Date.now() + BOT_STAND_DOWN_MINUTES * 60 * 1000,
    );
  }

  const scheduler = resolveWakeScheduler(platform, applicationId, settings);
  if (scheduler) {
    await scheduler.runDone(
      resolveChannelKeys(platform, applicationId, platformThreadId).channelKey,
    );
  }
};
