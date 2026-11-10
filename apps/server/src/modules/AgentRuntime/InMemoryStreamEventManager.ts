import debug from 'debug';

import {
  compareStreamIds,
  type StreamChunkData,
  type StreamEvent,
  stripFinalStateInEventData,
} from './StreamEventManager';
import { type IStreamEventManager, type PublishAgentRuntimeEndParams } from './types';

const log = debug('lobe-server:agent-runtime:in-memory-stream-event-manager');

const getDefaultReasonDetail = (finalState: any, reason?: string): string => {
  if (reason === 'error') {
    return finalState?.error?.message || finalState?.error?.type || 'Agent runtime failed';
  }

  if (reason === 'interrupted') {
    return finalState?.error?.message || 'Agent runtime interrupted';
  }

  return 'Agent runtime completed successfully';
};

type EventCallback = (events: StreamEvent[]) => void;

/** Matches Redis's two-hour inactivity TTL; streams are not trimmed by count. */
const STREAM_RETENTION_MS = 2 * 3600 * 1000;

/**
 * In-Memory Stream Event Manager
 * In-memory implementation for testing and local development environments
 */
export class InMemoryStreamEventManager implements IStreamEventManager {
  private streams: Map<string, StreamEvent[]> = new Map();
  private subscribers: Map<string, EventCallback[]> = new Map();
  private eventIdCounter = 0;
  private lastPublishedAt = new Map<string, number>();

  private evictExpiredStreams(): void {
    const now = Date.now();
    for (const [operationId, publishedAt] of this.lastPublishedAt) {
      if (now - publishedAt <= STREAM_RETENTION_MS) continue;
      this.streams.delete(operationId);
      this.lastPublishedAt.delete(operationId);
    }
  }

  private generateEventId(): string {
    this.eventIdCounter++;
    return `${Date.now()}-${this.eventIdCounter}`;
  }

  async publishStreamEvent(
    operationId: string,
    event: Omit<StreamEvent, 'operationId' | 'timestamp'>,
  ): Promise<string> {
    this.evictExpiredStreams();
    const eventId = this.generateEventId();

    const eventData: StreamEvent = {
      ...event,
      // Mirror the Redis-backed manager's chokepoint strip so in-memory
      // event shape stays identical to the production wire format —
      // tests run against this manager and would otherwise mask
      // regressions in the strip behaviour.
      data: stripFinalStateInEventData(event.data, event.type),
      id: eventId,
      operationId,
      timestamp: Date.now(),
    };

    // Get or create stream
    let stream = this.streams.get(operationId);
    if (!stream) {
      stream = [];
      this.streams.set(operationId, stream);
    }

    stream.push(eventData);

    this.lastPublishedAt.set(operationId, Date.now());

    log('Published event %s for operation %s:%d', eventData.type, operationId, eventData.stepIndex);

    // Notify subscribers
    const callbacks = this.subscribers.get(operationId);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback([eventData]);
        } catch (error) {
          console.error('[InMemoryStreamEventManager] Subscriber callback error:', error);
        }
      }
    }

    return eventId;
  }

  async deleteStreamEvents(operationId: string, eventIds: string[]): Promise<void> {
    const stream = this.streams.get(operationId);
    if (!stream || eventIds.length === 0) return;
    const ids = new Set(eventIds);
    this.streams.set(
      operationId,
      stream.filter((event) => !event.id || !ids.has(event.id)),
    );
  }

  async publishStreamChunk(
    operationId: string,
    stepIndex: number,
    chunkData: StreamChunkData,
  ): Promise<string> {
    return this.publishStreamEvent(operationId, {
      data: chunkData,
      stepIndex,
      type: 'stream_chunk',
    });
  }

  async publishAgentRuntimeInit(operationId: string, initialState: any): Promise<string> {
    return this.publishStreamEvent(operationId, {
      data: initialState,
      stepIndex: 0,
      type: 'agent_runtime_init',
    });
  }

  async publishAgentRuntimeEnd({
    operationId,
    stepIndex,
    finalState,
    messagePatchMode,
    messageRevision,
    reason,
    reasonDetail,
    uiMessages,
  }: PublishAgentRuntimeEndParams): Promise<string> {
    // Strip happens centrally inside `publishStreamEvent`.
    return this.publishStreamEvent(operationId, {
      data: {
        ...(!messagePatchMode && { finalState }),
        ...(messagePatchMode && { messagePatchMode: true, messageRevision }),
        operationId,
        phase: 'execution_complete',
        reason: reason || 'completed',
        reasonDetail: reasonDetail || getDefaultReasonDetail(finalState, reason),
        ...(uiMessages !== undefined && { uiMessages }),
      },
      stepIndex,
      type: 'agent_runtime_end',
    });
  }

  async getStreamHistory(operationId: string, count: number = 100): Promise<StreamEvent[]> {
    const stream = this.streams.get(operationId);
    if (!stream) {
      return [];
    }

    // Return most recent count events (in reverse order)
    return stream.slice(-count).reverse();
  }

  async getStreamHistoryPage(operationId: string, cursor = '0', limit = 200) {
    this.evictExpiredStreams();
    const stream = this.streams.get(operationId);
    const unavailable = { available: false, events: [], hasMore: false, nextCursor: cursor };
    if (!stream || stream[0]?.type !== 'agent_runtime_init') return unavailable;
    if (cursor === '0') return this.historyPage(stream, 0, limit, cursor);

    const exact = stream.findIndex((event) => event.id === cursor);
    if (exact >= 0) return this.historyPage(stream, exact + 1, limit, cursor);

    // Mirror the Redis manager: a cursor removed by `deleteStreamEvents` sits
    // after the init with a newer event following it; anything else is lost.
    if (compareStreamIds(stream[0].id!, cursor) >= 0) return unavailable;
    const next = this.indexAfter(stream, cursor);
    return next < 0 ? unavailable : this.historyPage(stream, next, limit, cursor);
  }

  private historyPage(stream: StreamEvent[], start: number, limit: number, cursor: string) {
    const events = stream.slice(start, start + limit);
    return {
      available: true,
      events,
      hasMore: stream.length > start + limit,
      nextCursor: events.at(-1)?.id ?? cursor,
    };
  }

  /** Index of the first event newer than `cursor`, or -1. */
  private indexAfter(stream: StreamEvent[], cursor: string): number {
    return stream.findIndex((event) => !!event.id && compareStreamIds(event.id, cursor) > 0);
  }

  /**
   * Single bounded read — the long-poll primitive (see `IStreamEventManager`).
   * The in-memory manager is non-blocking: it returns immediately with whatever
   * is already buffered after `lastEventId`. `'$'` means "from now", so the
   * first poll returns nothing and hands back the current tail cursor; later
   * polls return events appended since. `blockMs` is ignored (tests/local dev
   * only — the Redis manager provides the real blocking wait).
   */
  async readEventsOnce(
    operationId: string,
    lastEventId: string = '$',
    _blockMs: number = 0,
  ): Promise<{ events: StreamEvent[]; lastEventId: string }> {
    const stream = this.streams.get(operationId) ?? [];

    if (lastEventId === '$') {
      return { events: [], lastEventId: stream.at(-1)?.id ?? '0' };
    }

    // Like XREAD: everything newer than the cursor, even if the cursor's own
    // event was removed by `deleteStreamEvents`.
    const idx = this.indexAfter(stream, lastEventId);
    const events = idx >= 0 ? stream.slice(idx) : [];
    return { events, lastEventId: events.at(-1)?.id ?? lastEventId };
  }

  async cleanupOperation(operationId: string): Promise<void> {
    this.lastPublishedAt.delete(operationId);
    this.streams.delete(operationId);
    this.subscribers.delete(operationId);
    log('Cleaned up operation %s', operationId);
  }

  async getActiveOperationsCount(): Promise<number> {
    return this.streams.size;
  }

  async disconnect(): Promise<void> {
    // In-memory implementation doesn't need to disconnect
    log('InMemoryStreamEventManager disconnected');
  }

  /**
   * Subscribe to stream events (for SSE endpoint)
   * Compatible with Redis StreamEventManager.subscribeStreamEvents
   */
  async subscribeStreamEvents(
    operationId: string,
    _lastEventId: string,
    onEvents: (events: StreamEvent[]) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const unsubscribe = this.subscribe(operationId, (events) => {
        onEvents(events);
        // Check if agent_runtime_end was received — caller will handle closing
        const hasEnd = events.some((e) => e.type === 'agent_runtime_end');
        if (hasEnd) {
          unsubscribe();
          resolve();
        }
      });

      // Handle abort signal
      if (signal) {
        const onAbort = () => {
          unsubscribe();
          resolve();
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  /**
   * Subscribe to stream events (for testing)
   */
  subscribe(operationId: string, callback: EventCallback): () => void {
    let callbacks = this.subscribers.get(operationId);
    if (!callbacks) {
      callbacks = [];
      this.subscribers.set(operationId, callbacks);
    }
    callbacks.push(callback);

    // Return unsubscribe function
    return () => {
      const cbs = this.subscribers.get(operationId);
      if (cbs) {
        const index = cbs.indexOf(callback);
        if (index > -1) {
          cbs.splice(index, 1);
        }
      }
    };
  }

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    this.lastPublishedAt.clear();
    this.streams.clear();
    this.subscribers.clear();
    this.eventIdCounter = 0;
    log('All data cleared');
  }

  /**
   * Get all events (for test verification)
   */
  getAllEvents(operationId: string): StreamEvent[] {
    return this.streams.get(operationId) ?? [];
  }

  /**
   * Wait for a specific event type (for testing)
   */
  waitForEvent(
    operationId: string,
    eventType: StreamEvent['type'],
    timeout: number = 5000,
  ): Promise<StreamEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timeout waiting for event ${eventType}`));
      }, timeout);

      const unsubscribe = this.subscribe(operationId, (events) => {
        for (const event of events) {
          if (event.type === eventType) {
            clearTimeout(timer);
            unsubscribe();
            resolve(event);
            return;
          }
        }
      });

      // Check existing events
      const existingEvents = this.streams.get(operationId) ?? [];
      for (const event of existingEvents) {
        if (event.type === eventType) {
          clearTimeout(timer);
          unsubscribe();
          resolve(event);
          return;
        }
      }
    });
  }
}

/**
 * Singleton instance for testing and local development environments
 */
export const inMemoryStreamEventManager = new InMemoryStreamEventManager();
