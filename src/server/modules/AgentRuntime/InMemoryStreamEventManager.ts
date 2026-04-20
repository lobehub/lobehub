import debug from 'debug';

import { type StreamChunkData, type StreamEvent } from './StreamEventManager';
import { type IStreamEventManager } from './types';

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

/**
 * In-Memory Stream Event Manager
 * In-memory implementation for testing and local development environments
 */
export class InMemoryStreamEventManager implements IStreamEventManager {
  private streams: Map<string, StreamEvent[]> = new Map();
  private subscribers: Map<string, EventCallback[]> = new Map();
  private eventIdCounter = 0;

  private generateEventId(): string {
    this.eventIdCounter++;
    return `${Date.now()}-${this.eventIdCounter}`;
  }

  async publishStreamEvent(
    operationId: string,
    event: Omit<StreamEvent, 'operationId' | 'timestamp'>,
  ): Promise<string> {
    const eventId = this.generateEventId();

    const eventData: StreamEvent = {
      ...event,
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

    // Limit stream length to prevent memory overflow
    if (stream.length > 1000) {
      stream.shift();
    }

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

  async publishAgentRuntimeEnd(
    operationId: string,
    stepIndex: number,
    finalState: any,
    reason?: string,
    reasonDetail?: string,
  ): Promise<string> {
    return this.publishStreamEvent(operationId, {
      data: {
        finalState,
        operationId,
        phase: 'execution_complete',
        reason: reason || 'completed',
        reasonDetail: reasonDetail || getDefaultReasonDetail(finalState, reason),
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

  async cleanupOperation(operationId: string): Promise<void> {
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
