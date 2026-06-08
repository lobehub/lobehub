import type { EmitSourceEventResult, SignalTriggerMetadata } from '@lobechat/agent-signal';
import { SpanStatusCode } from '@lobechat/observability-otel/api';
import {
  sourceEventCounter,
  sourceEventDurationHistogram,
  tracer,
} from '@lobechat/observability-otel/modules/agent-signal';
import { attributesCommon } from '@lobechat/observability-otel/node';

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

const buildSourceEventMetricAttributes = (
  input: EmitSourceEventInput,
  status: 'accepted' | 'duplicate' | 'error' | 'scope_locked',
) => ({
  'agent.signal.source_event_status': status,
  'agent.signal.source_type': input.sourceType,
  ...attributesCommon(),
});

export { buildSource } from './buildSource';
export type { EmitSourceEventInput } from './types';

/**
 * Generates one normalized AgentSignal source event and records ingress observability.
 *
 * Search spans:
 * - `agent_signal.source_event.generate`
 *
 * Expected attributes:
 * - `agent.signal.scope_key`
 * - `agent.signal.source_id`
 * - `agent.signal.source_type`
 * - `agent.signal.window_event_count` when the source event is accepted
 *
 * Expected events:
 * - none; this boundary currently uses span status plus metrics instead of span events
 *
 * Expected metrics:
 * - `agent_signal_source_events_total`
 * - `agent_signal_source_event_duration_ms`
 *
 * Metric attributes:
 * - `agent.signal.source_event_status`: `accepted | duplicate | scope_locked | error`
 * - `agent.signal.source_type`
 *
 * Failure modes:
 * - Returns deduped `duplicate` when the event id was already seen
 * - Returns deduped `scope_locked` when another producer owns the scope lock
 * - Marks the span as `ERROR` and rethrows when storage operations fail
 */
export const emitSourceEvent = async (
  input: EmitSourceEventInput,
  options: EmitSourceEventOptions = {},
): Promise<EmitSourceEventResult> => {
  const startedAt = Date.now();

  return tracer.startActiveSpan(
    'agent_signal.source_event.generate',
    {
      attributes: {
        'agent.signal.scope_key': input.scopeKey,
        'agent.signal.source_id': input.sourceId,
        'agent.signal.source_type': input.sourceType,
      },
    },
    async (span) => {
      const store = options.store ?? defaultSourceEventStore;
      const eventId = buildEventId(input);
      let sourceEventStatus: 'accepted' | 'duplicate' | 'error' | 'scope_locked' = 'accepted';

      try {
        const deduped = await store.tryDedupe(
          eventId,
          AGENT_SIGNAL_DEFAULTS.signalDedupeTtlSeconds,
        );

        if (!deduped) {
          sourceEventStatus = 'duplicate';
          sourceEventCounter.add(1, buildSourceEventMetricAttributes(input, sourceEventStatus));
          span.setStatus({ code: SpanStatusCode.OK, message: 'duplicate' });

          return { deduped: true as const, reason: 'duplicate' as const };
        }

        const locked = await store.acquireScopeLock(
          input.scopeKey,
          AGENT_SIGNAL_DEFAULTS.generationLockTtlSeconds,
        );

        if (!locked) {
          sourceEventStatus = 'scope_locked';
          sourceEventCounter.add(1, buildSourceEventMetricAttributes(input, sourceEventStatus));
          span.setStatus({ code: SpanStatusCode.OK, message: 'scope_locked' });

          return { deduped: true as const, reason: 'scope_locked' as const };
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

          sourceEventStatus = 'accepted';
          sourceEventCounter.add(1, buildSourceEventMetricAttributes(input, sourceEventStatus));
          span.setAttribute('agent.signal.window_event_count', nextCount);
          span.setStatus({ code: SpanStatusCode.OK });

          return {
            deduped: false as const,
            source: buildSource(input),
            trigger: buildTrigger(input.scopeKey, eventId, nextCount),
          };
        } finally {
          await store.releaseScopeLock(input.scopeKey);
        }
      } catch (error) {
        sourceEventStatus = 'error';
        sourceEventCounter.add(1, buildSourceEventMetricAttributes(input, sourceEventStatus));
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message:
            error instanceof Error ? error.message : 'AgentSignal source event generation failed',
        });
        span.recordException(error as Error);

        throw error;
      } finally {
        sourceEventDurationHistogram.record(
          Date.now() - startedAt,
          buildSourceEventMetricAttributes(input, sourceEventStatus),
        );
        span.end();
      }
    },
  );
};
