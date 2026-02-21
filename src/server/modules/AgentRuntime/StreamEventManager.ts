import { type ChatToolPayload } from '@lobechat/types';
import debug from 'debug';
import { type Redis } from 'ioredis';

import { getAgentRuntimeRedisClient } from './redis';

const log = debug('lobe-server:agent-runtime:stream-event-manager');
const timing = debug('lobe-server:agent-runtime:timing');

export interface StreamEvent {
  data: any;
  id?: string; // Redis Stream event ID
  operationId: string;
  stepIndex: number;
  timestamp: number;
  type:
    | 'agent_runtime_init'
    | 'agent_runtime_end'
    | 'stream_start'
    | 'stream_chunk'
    | 'stream_end'
    | 'tool_start'
    | 'tool_end'
    | 'step_start'
    | 'step_complete'
    | 'error';
}

export interface StreamChunkData {
  chunkType:
    | 'text'
    | 'reasoning'
    | 'tools_calling'
    | 'image'
    | 'grounding'
    | 'base64_image'
    | 'content_part'
    | 'reasoning_part';
  content?: string;
  /** Multimodal content parts (text + images) */
  contentParts?: Array<{ text: string; type: 'text' } | { image: string; type: 'image' }>;
  /** Grounding/search data */
  grounding?: any;
  /** Image list for base64_image chunks */
  imageList?: any[];
  images?: any[];
  reasoning?: string;
  /** Multimodal reasoning parts (text + images) */
  reasoningParts?: Array<{ text: string; type: 'text' } | { image: string; type: 'image' }>;
  toolsCalling?: ChatToolPayload[];
}

export class StreamEventManager {
  private redis: Redis;
  private readonly STREAM_PREFIX = 'agent_runtime_stream';
  private readonly STREAM_RETENTION = 2 * 3600; // 2 hours

  constructor() {
    const redisClient = getAgentRuntimeRedisClient();
    if (!redisClient) {
      throw new Error('Redis is not available. Please configure REDIS_URL environment variable.');
    }
    this.redis = redisClient;
  }

  /**
   * Publish stream event to Redis Stream
   */
  async publishStreamEvent(
    operationId: string,
    event: Omit<StreamEvent, 'operationId' | 'timestamp'>,
  ): Promise<string> {
    const streamKey = `${this.STREAM_PREFIX}:${operationId}`;

    const eventData: StreamEvent = {
      ...event,
      operationId,
      timestamp: Date.now(),
    };

    try {
      const xaddStart = Date.now();
      const eventId = await this.redis.xadd(
        streamKey,
        'MAXLEN',
        '~',
        '1000', // Limit stream length to prevent memory overflow
        '*', // Auto-generate ID
        'type',
        eventData.type,
        'stepIndex',
        eventData.stepIndex.toString(),
        'operationId',
        eventData.operationId,
        'data',
        JSON.stringify(eventData.data),
        'timestamp',
        eventData.timestamp.toString(),
      );
      const xaddEnd = Date.now();

      // Set expiration time
      await this.redis.expire(streamKey, this.STREAM_RETENTION);

      log(
        'Published event %s for operation %s:%d',
        eventData.type,
        operationId,
        eventData.stepIndex,
      );

      timing(
        '[%s:%d] Redis XADD %s at %d, took %dms',
        operationId,
        eventData.stepIndex,
        eventData.type,
        xaddStart,
        xaddEnd - xaddStart,
      );

      return eventId as string;
    } catch (error) {
      console.error('[StreamEventManager] Failed to publish stream event:', error);
      throw error;
    }
  }

  /**
   * Publish stream content chunk
   */
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

  /**
   * Publish Agent runtime initialization event
   */
  async publishAgentRuntimeInit(operationId: string, initialState: any): Promise<string> {
    return this.publishStreamEvent(operationId, {
      data: initialState,
      stepIndex: 0,
      type: 'agent_runtime_init',
    });
  }

  /**
   * Publish Agent runtime end event
   */
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
        reasonDetail: reasonDetail || 'Agent runtime completed successfully',
      },
      stepIndex,
      type: 'agent_runtime_end',
    });
  }

  /**
   * Subscribe to stream events (for WebSocket/SSE)
   */
  async subscribeStreamEvents(
    operationId: string,
    lastEventId: string = '0',
    onEvents: (events: StreamEvent[]) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const streamKey = `${this.STREAM_PREFIX}:${operationId}`;
    let currentLastId = lastEventId;

    log('Starting subscription for operation %s from %s', operationId, lastEventId);

    while (!signal?.aborted) {
      try {
        const xreadStart = Date.now();
        const results = await this.redis.xread(
          'BLOCK',
          1000, // 1 second timeout
          'STREAMS',
          streamKey,
          currentLastId,
        );
        const xreadEnd = Date.now();

        if (results && results.length > 0) {
          const [, messages] = results[0];
          const events: StreamEvent[] = [];

          for (const [id, fields] of messages) {
            const eventData: any = {};

            // Parse Redis Stream fields
            for (let i = 0; i < fields.length; i += 2) {
              const key = fields[i];
              const value = fields[i + 1];

              if (key === 'data') {
                eventData[key] = JSON.parse(value);
              } else if (key === 'stepIndex' || key === 'timestamp') {
                eventData[key] = parseInt(value);
              } else {
                eventData[key] = value;
              }
            }

            events.push({
              ...eventData,
              id, // Redis Stream event ID
            } as StreamEvent);

            currentLastId = id;
          }

          if (events.length > 0) {
            const now = Date.now();
            // Calculate latency from event publication to read
            for (const event of events) {
              const latency = now - event.timestamp;
              timing(
                '[%s:%d] XREAD %s, published at %d, read at %d, latency %dms, xread took %dms',
                operationId,
                event.stepIndex,
                event.type,
                event.timestamp,
                now,
                latency,
                xreadEnd - xreadStart,
              );
            }
            onEvents(events);
          }
        }
      } catch (error) {
        if (signal?.aborted) {
          break;
        }

        console.error('[StreamEventManager] Stream subscription error:', error);
        // Retry after brief delay
        await new Promise((resolve) => {
          setTimeout(resolve, 1000);
        });
      }
    }

    log('Subscription ended for operation %s', operationId);
  }

  /**
   * Get stream event history
   */
  async getStreamHistory(operationId: string, count: number = 100): Promise<StreamEvent[]> {
    const streamKey = `${this.STREAM_PREFIX}:${operationId}`;

    try {
      const results = await this.redis.xrevrange(streamKey, '+', '-', 'COUNT', count);

      return results.map(([id, fields]) => {
        const eventData: any = { id };

        for (let i = 0; i < fields.length; i += 2) {
          const key = fields[i];
          const value = fields[i + 1];

          if (key === 'data') {
            eventData[key] = JSON.parse(value);
          } else if (key === 'stepIndex' || key === 'timestamp') {
            eventData[key] = parseInt(value);
          } else {
            eventData[key] = value;
          }
        }

        return eventData as StreamEvent;
      });
    } catch (error) {
      console.error('[StreamEventManager] Failed to get stream history:', error);
      return [];
    }
  }

  /**
   * Clean up stream data for operation
   */
  async cleanupOperation(operationId: string): Promise<void> {
    const streamKey = `${this.STREAM_PREFIX}:${operationId}`;

    try {
      await this.redis.del(streamKey);
      log('Cleaned up operation %s', operationId);
    } catch (error) {
      console.error('[StreamEventManager] Failed to cleanup operation:', error);
    }
  }

  /**
   * Get count of active operations
   */
  async getActiveOperationsCount(): Promise<number> {
    try {
      const pattern = `${this.STREAM_PREFIX}:*`;
      const keys = await this.redis.keys(pattern);
      return keys.length;
    } catch (error) {
      console.error('[StreamEventManager] Failed to get active operations count:', error);
      return 0;
    }
  }

  /**
   * Close Redis connection
   */
  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}
