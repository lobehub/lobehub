import { type ChatToolPayload } from '@lobechat/types';
import debug from 'debug';
import type { Redis } from 'ioredis';

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
  private readonly STREAM_RETENTION = 2 * 3600; // 2小时

  constructor() {
    const redisClient = getAgentRuntimeRedisClient();
    if (!redisClient) {
      throw new Error('Redis is not available. Please configure REDIS_URL environment variable.');
    }
    this.redis = redisClient;
  }

  /**
   * 发布流式事件到 Redis Stream
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
        '1000', // 限制流长度，防止内存溢出
        '*', // 自动生成 ID
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

      // 设置过期时间
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
   * 发布流式内容块
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
   * 发布 Agent 运行时初始化事件
   */
  async publishAgentRuntimeInit(operationId: string, initialState: any): Promise<string> {
    return this.publishStreamEvent(operationId, {
      data: initialState,
      stepIndex: 0,
      type: 'agent_runtime_init',
    });
  }

  /**
   * 发布 Agent 运行时结束事件
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
   * 订阅流式事件（用于 WebSocket/SSE）
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
          1000, // 1秒超时
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

            // 解析 Redis Stream 字段
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
              id, // Redis Stream 事件 ID
            } as StreamEvent);

            currentLastId = id;
          }

          if (events.length > 0) {
            const now = Date.now();
            // 计算事件从发布到被读取的延迟
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
        // 短暂延迟后重试
        await new Promise((resolve) => {
          setTimeout(resolve, 1000);
        });
      }
    }

    log('Subscription ended for operation %s', operationId);
  }

  /**
   * 获取流式事件历史
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
   * 清理操作的流式数据
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
   * 获取活跃操作数量
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
   * 关闭 Redis 连接
   */
  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}
