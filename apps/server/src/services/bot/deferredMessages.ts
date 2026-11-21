import type { Message } from 'chat';
import debug from 'debug';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { redisService } from '@/server/services/redis';

import { getOriginMessageId, isReplayMessage } from './mergeMessages';

const log = debug('lobe-server:bot:deferred-messages');

/**
 * Cross-process queue for inbound bot messages that arrive while the thread's
 * topic still has a live agent run.
 *
 * Why this exists: in queue mode the bridge hands the run to the job queue and
 * returns immediately, so both the Chat SDK thread lock and the in-process
 * `activeThreads` guard are released long before the agent finishes. A
 * follow-up that lands in that window (WeChat delivers "one image + one
 * sentence" as two messages a few hundred ms apart) used to race the
 * topic-start reservation, lose, and surface as "Agent Execution Failed".
 *
 * Instead the bridge parks the serialized message here, and the completion
 * callback replays every parked message through the Chat SDK once the run is
 * done — the same path a brand-new inbound message takes, so subscription /
 * mention / command routing stay untouched.
 *
 * Key layout: `bot:deferred-messages:<applicationId>:<platformThreadId>`.
 * Scoped by application because one WeChat user can talk to several bots and
 * their thread ids collide (`wechat:single:<userId>`).
 *
 * Entries are `Message.toJSON()` payloads. `raw` survives serialization, which
 * is what the per-platform `extractFiles` needs to re-download media after the
 * round-trip (the same contract the SDK's own queue relies on).
 */
export type DeferredBotMessage = ReturnType<Message['toJSON']>;

/** Matches the agent execution ceiling so a crashed run can't strand entries. */
const TTL_SECONDS = 30 * 60;

/** Hard cap so a runaway sender cannot grow the list unboundedly. */
export const MAX_DEFERRED_PER_THREAD = 20;

export const buildDeferredMessagesKey = (applicationId: string, platformThreadId: string): string =>
  `bot:deferred-messages:${applicationId}:${platformThreadId}`;

/**
 * How many times one platform message may be delivered to a run. A replay parked again because the
 * topic is still busy (another sender's message took the run) did not run, and gets its lap back
 * when it is parked; one that keeps being run and coming back is looping (each lap is a full agent
 * run and a reply in the chat) and is dropped instead.
 */
export const MAX_REPLAYS_PER_MESSAGE = 3;

/**
 * Whether deferral is available at all — it needs Redis because the replay
 * happens in the callback process, not the one that received the message.
 */
export const isDeferredMessagesAvailable = (): boolean => !!getAgentRuntimeRedisClient();

/**
 * Park messages (chronological) for replay after the running agent completes.
 * A merged message should be passed as its individual sources so each one
 * keeps its own `raw` for media re-download.
 *
 * @returns `true` when the messages were stored; `false` when Redis is
 * unavailable or the write failed — callers should then fall back to the
 * previous (fail-fast) behavior rather than drop the message silently.
 */
export async function deferBotMessages(
  applicationId: string,
  platformThreadId: string,
  messages: Message[],
): Promise<boolean> {
  const redis = getAgentRuntimeRedisClient();
  if (!redis || messages.length === 0) return false;

  const key = buildDeferredMessagesKey(applicationId, platformThreadId);
  try {
    const payloads = messages.map((message) => JSON.stringify(message.toJSON()));
    const results = await redis
      .multi()
      .rpush(key, ...payloads)
      .ltrim(key, -MAX_DEFERRED_PER_THREAD, -1)
      .expire(key, TTL_SECONDS)
      .exec();
    const failure = results?.find(([error]) => error)?.[0];
    if (!results || failure) throw failure ?? new Error('Deferred write aborted');
    // A replay parked again was delivered without running: give back the lap its delivery is
    // about to be counted for, so waiting behind other senders never spends the budget. Only once
    // the park is stored; a lost refund costs one lap, never the message.
    const reparked = messages.filter((message) => isReplayMessage(message));
    await redisService.botDeferred.refundReplays(
      applicationId,
      platformThreadId,
      reparked.map((message) => getOriginMessageId(message)),
    );
    log(
      'deferred %d message(s) [%s] for thread=%s app=%s',
      messages.length,
      messages.map((message) => message.id).join(','),
      platformThreadId,
      applicationId,
    );
    return true;
  } catch (error) {
    log('deferBotMessage failed for thread=%s: %O', platformThreadId, error);
    return false;
  }
}

interface DeferredSnapshotEntry {
  message: DeferredBotMessage;
  /** The stored string, acknowledged as is: re-serializing a parsed entry may not match it. */
  payload: string;
}

const readSnapshot = async (
  applicationId: string,
  platformThreadId: string,
): Promise<DeferredSnapshotEntry[]> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return [];
  const key = buildDeferredMessagesKey(applicationId, platformThreadId);
  const payloads = await redis.lrange(key, 0, -1);
  const entries: DeferredSnapshotEntry[] = [];
  for (const payload of payloads) {
    try {
      entries.push({ message: JSON.parse(payload) as DeferredBotMessage, payload });
    } catch (error) {
      log('Invalid deferred payload for thread=%s: %O', platformThreadId, error);
    }
  }
  return entries;
};

/** Read a snapshot without removing messages before the SDK accepts them. */
export async function readDeferredBotMessages(
  applicationId: string,
  platformThreadId: string,
): Promise<DeferredBotMessage[]> {
  const entries = await readSnapshot(applicationId, platformThreadId);
  return entries.map((entry) => entry.message);
}

/**
 * One entry per platform message. A replay parked again while the snapshot it came from is still
 * unacknowledged sits in the queue next to that snapshot's copy; replaying both starts one run and
 * parks the other again, which is how a single message looped. Keeps the first copy's position
 * (chronological order) and the newest copy's payload.
 */
const latestPerOrigin = (messages: DeferredBotMessage[]): DeferredBotMessage[] => {
  const byOrigin = new Map<string, DeferredBotMessage>();
  for (const message of messages) byOrigin.set(getOriginMessageId(message), message);
  return [...byOrigin.values()];
};

/**
 * Drop the messages whose replay budget is spent. Only reads the counts: a delivery that fails
 * before the SDK takes the message (no adapter, Redis hiccup) must not use up the budget, or the
 * retry job would drop a message it was meant to deliver. A count that cannot be read fails open:
 * the per-origin collapse above already stops the known loop.
 */
const withinReplayBudget = async (
  applicationId: string,
  platformThreadId: string,
  messages: DeferredBotMessage[],
): Promise<DeferredBotMessage[]> => {
  const counts = await redisService.botDeferred.replayCounts(
    applicationId,
    platformThreadId,
    messages.map((message) => getOriginMessageId(message)),
  );
  if (!counts) return messages;
  return messages.filter((message, index) => {
    if (counts[index] < MAX_REPLAYS_PER_MESSAGE) return true;
    log(
      'Dropping message=%s on thread=%s: replayed %d times without leaving the queue',
      getOriginMessageId(message),
      platformThreadId,
      counts[index],
    );
    return false;
  });
};

/**
 * Acknowledge only the snapshot successfully handed to the SDK. New arrivals
 * remain queued. A failure (including process/Redis failure) leaves the original
 * entries available for retry. Delivery is at-least-once if a batch partially
 * succeeds or completion callbacks overlap; copies of one message are replayed
 * once, and a message is delivered at most {@link MAX_REPLAYS_PER_MESSAGE} times
 * (failed deliveries and replays parked again while the topic is busy do not count).
 */
export async function replayDeferredBotMessages(
  applicationId: string,
  platformThreadId: string,
  replay: (entries: DeferredBotMessage[]) => Promise<void>,
): Promise<void> {
  const snapshot = await readSnapshot(applicationId, platformThreadId);
  if (snapshot.length === 0) return;
  const due = await withinReplayBudget(
    applicationId,
    platformThreadId,
    latestPerOrigin(snapshot.map((entry) => entry.message)),
  );
  if (due.length > 0) {
    await replay(due);
    await redisService.botDeferred.countReplays(
      applicationId,
      platformThreadId,
      due.map((message) => getOriginMessageId(message)),
    );
  }

  const redis = getAgentRuntimeRedisClient();
  if (!redis) throw new Error('Redis unavailable while acknowledging deferred messages');
  const key = buildDeferredMessagesKey(applicationId, platformThreadId);
  const transaction = redis.multi();
  for (const entry of snapshot) transaction.lrem(key, 1, entry.payload);
  const results = await transaction.exec();
  const failure = results?.find(([error]) => error)?.[0];
  if (!results || failure) throw failure ?? new Error('Deferred replay acknowledgement aborted');
}
