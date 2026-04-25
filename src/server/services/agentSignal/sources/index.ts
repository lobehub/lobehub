import type { EmitSourceEventResult, SignalTriggerMetadata } from '@lobechat/agent-signal';

import { AGENT_SIGNAL_DEFAULTS } from '../constants';
import { redisSourceEventStore } from '../store/adapters/redis/sourceEventStore';
import type { AgentSignalSourceEventStore } from '../store/types';
import { buildSource } from './buildSource';
import type { EmitSourceEventInput } from './types';

/** Options for source-event generation. */
export interface EmitSourceEventOptions {
  store?: AgentSignalSourceEventStore;
}

const defaultSourceEventStore: AgentSignalSourceEventStore = redisSourceEventStore;

const buildEventId = (input: EmitSourceEventInput) => {
  return `${input.scopeKey}:${input.sourceType}:${input.sourceId}:${input.timestamp}`;
};

const buildTrigger = (
  scopeKey: string,
  eventId: string,
  windowEventCount: number,
): SignalTriggerMetadata => {
  return {
    scopeKey,
    token: `trigger:${eventId}`,
    windowEventCount,
  };
};

export { buildSource } from './buildSource';
export type { EmitSourceEventInput } from './types';

export const emitSourceEvent = async (
  input: EmitSourceEventInput,
  options: EmitSourceEventOptions = {},
): Promise<EmitSourceEventResult> => {
  const store = options.store ?? defaultSourceEventStore;
  const eventId = buildEventId(input);
  const deduped = await store.tryDedupe(eventId, AGENT_SIGNAL_DEFAULTS.signalDedupeTtlSeconds);

  if (!deduped) {
    return { deduped: true, reason: 'duplicate' };
  }

  const locked = await store.acquireScopeLock(
    input.scopeKey,
    AGENT_SIGNAL_DEFAULTS.generationLockTtlSeconds,
  );

  if (!locked) {
    return { deduped: true, reason: 'scope_locked' };
  }

  try {
    const currentWindow = await store.readWindow(input.scopeKey);
    const previousCount = Number(currentWindow?.eventCount ?? '0');
    const nextCount = previousCount + 1;

    await store.writeWindow(
      input.scopeKey,
      {
        eventCount: String(nextCount),
        lastEventAt: String(input.timestamp),
        lastEventId: eventId,
      },
      AGENT_SIGNAL_DEFAULTS.signalWindowTtlSeconds,
    );

    return {
      deduped: false,
      source: buildSource(input),
      trigger: buildTrigger(input.scopeKey, eventId, nextCount),
    };
  } finally {
    await store.releaseScopeLock(input.scopeKey);
  }
};
