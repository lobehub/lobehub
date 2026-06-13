import debug from 'debug';

// Import the transport pieces from their concrete modules rather than the
// `@/server/modules/AgentRuntime` barrel: the barrel re-exports RuntimeExecutors,
// which eagerly constructs the ModelRuntime ApiKeyManager at module load and
// throws in client/test contexts. These leaf modules pull no ModelRuntime.
import { inMemoryStreamEventManager } from '@/server/modules/AgentRuntime/InMemoryStreamEventManager';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { StreamEventManager } from '@/server/modules/AgentRuntime/StreamEventManager';
import type { IStreamEventManager } from '@/server/modules/AgentRuntime/types';

import type { ReceivedResourceEvent, ResourceEvent, ResourceRef } from './types';

export type { ReceivedResourceEvent, ResourceEvent, ResourceRef, ResourceType } from './types';

const log = debug('lobe-server:resource-events');

/** Redis Stream / in-memory channel key for a resource. */
export const resourceChannelId = (ref: ResourceRef): string => `resource:${ref.type}:${ref.id}`;

/**
 * Select the underlying transport. We deliberately bypass
 * `createStreamEventManager()` — its `GatewayStreamNotifier` wrapper POSTs every
 * published event to the agent gateway, which must not see resource events.
 * Evaluated per call so it picks up Redis becoming (un)available.
 */
const getManager = (): IStreamEventManager =>
  getAgentRuntimeRedisClient() !== null ? new StreamEventManager() : inMemoryStreamEventManager;

/**
 * Realtime event fan-out for editable resources, keyed by (resourceType, id).
 *
 * A thin, table-agnostic wrapper over the existing Redis-Streams transport so
 * presence and (eventually) real-time co-editing can reuse the same channel.
 * The lease/lock is advisory and this channel is best-effort: publishing never
 * throws, and with no Redis the in-memory manager keeps single-instance dev
 * working while clients fall back to their polling heartbeat.
 */
export const publishResourceEvent = async (
  ref: ResourceRef,
  event: ResourceEvent,
): Promise<void> => {
  try {
    await getManager().publishStreamEvent(resourceChannelId(ref), {
      // The agent StreamEvent shape (stepIndex + closed `type` union) is an
      // implementation detail of the transport; cast at this single boundary.
      data: { actorId: event.actorId, ...event.data },
      stepIndex: 0,
      type: event.type,
    } as unknown as Parameters<IStreamEventManager['publishStreamEvent']>[1]);
  } catch (error) {
    // Best-effort: a transport hiccup must never break the caller's save/lock op.
    log('publishResourceEvent failed for %s:%s %O', ref.type, ref.id, error);
  }
};

/**
 * Subscribe to a resource's events until `signal` aborts. Only events published
 * after subscription are delivered (no history replay).
 */
export const subscribeResourceEvents = async (
  ref: ResourceRef,
  onEvent: (event: ReceivedResourceEvent) => void,
  signal: AbortSignal,
): Promise<void> => {
  await getManager().subscribeStreamEvents(
    resourceChannelId(ref),
    '$',
    (events) => {
      for (const e of events) {
        const { actorId, ...rest } = (e.data ?? {}) as Record<string, unknown>;
        onEvent({
          actorId: typeof actorId === 'string' ? actorId : '',
          data: rest,
          timestamp: e.timestamp,
          type: e.type as unknown as ResourceEvent['type'],
        });
      }
    },
    signal,
  );
};
