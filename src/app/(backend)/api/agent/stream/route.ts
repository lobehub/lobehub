import { createSSEHeaders, createSSEWriter } from '@lobechat/utils/server';
import debug from 'debug';
import { type NextRequest, NextResponse } from 'next/server';

import { StreamEventManager } from '@/server/modules/AgentRuntime';

const log = debug('api-route:agent:stream');
const timing = debug('lobe-server:agent-runtime:timing');

/**
 * Server-Sent Events (SSE) endpoint
 * Provides real-time Agent execution event stream for clients
 */
export async function GET(request: NextRequest) {
  // Initialize stream event manager
  const streamManager = new StreamEventManager();

  const { searchParams } = new URL(request.url);
  const operationId = searchParams.get('operationId');
  const lastEventId = searchParams.get('lastEventId') || '0';
  const includeHistory = searchParams.get('includeHistory') === 'true';

  if (!operationId) {
    return NextResponse.json(
      {
        error: 'operationId parameter is required',
      },
      { status: 400 },
    );
  }

  log(`Starting SSE connection for operation ${operationId} from eventId ${lastEventId}`);

  // 创建 Server-Sent Events 流
  const stream = new ReadableStream({
    cancel(reason) {
      log(`SSE connection cancelled for operation ${operationId}:`, reason);

      // Call cleanup function
      if ((this as any)._cleanup) {
        (this as any)._cleanup();
      }
    },

    start(controller) {
      const writer = createSSEWriter(controller);

      // 发送连接确认事件
      writer.writeConnection(operationId, lastEventId);
      log(`SSE connection established for operation ${operationId}`);

      // 如果需要，先发送历史事件
      if (includeHistory) {
        streamManager
          .getStreamHistory(operationId, 50)
          .then((history) => {
            // 按时间顺序发送历史事件（最早的在前面）
            const sortedHistory = history.reverse();

            sortedHistory.forEach((event) => {
              // 只发送比 lastEventId 更新的事件
              if (!lastEventId || lastEventId === '0' || event.timestamp.toString() > lastEventId) {
                try {
                  // 添加 SSE 特定的字段，保持与实时事件格式一致
                  const sseEvent = {
                    ...event,
                    operationId,
                    timestamp: event.timestamp || Date.now(),
                  };
                  writer.writeStreamEvent(sseEvent, operationId);
                } catch (error) {
                  console.error('[Agent Stream] Error sending history event:', error);
                }
              }
            });

            if (sortedHistory.length > 0) {
              log(`Sent ${sortedHistory.length} historical events for operation ${operationId}`);
            }
          })
          .catch((error) => {
            console.error('[Agent Stream] Failed to load history:', error);

            try {
              writer.writeError(error, operationId, 'history_loading');
            } catch (controllerError) {
              console.error('[Agent Stream] Failed to send error event:', controllerError);
            }
          });
      }

      // 创建 AbortController 用于取消订阅
      const abortController = new AbortController();

      // Track if stream has ended (agent_runtime_end received)
      // Once set to true, no more events will be sent
      let streamEnded = false;

      // 定期发送心跳（每 30 秒）
      const heartbeatInterval = setInterval(() => {
        // Skip heartbeat if stream has ended
        if (streamEnded) {
          return;
        }

        try {
          const heartbeat = {
            operationId,
            timestamp: Date.now(),
            type: 'heartbeat',
          };

          controller.enqueue(`data: ${JSON.stringify(heartbeat)}\n\n`);
        } catch (error) {
          console.error('[Agent Stream] Heartbeat error:', error);
          clearInterval(heartbeatInterval);
        }
      }, 30_000);

      // Cleanup function
      const cleanup = () => {
        abortController.abort();
        clearInterval(heartbeatInterval);
        log(`SSE connection closed for operation ${operationId}`);
      };

      // 订阅新的流式事件
      const subscribeToEvents = async () => {
        try {
          await streamManager.subscribeStreamEvents(
            operationId,
            lastEventId,
            (events) => {
              events.forEach((event) => {
                // Skip all events if stream has ended
                if (streamEnded) {
                  return;
                }

                try {
                  // 添加 SSE 特定的字段
                  const sseEvent = {
                    ...event,
                    operationId,
                    timestamp: event.timestamp || Date.now(),
                  };

                  const now = Date.now();
                  const totalLatency = now - sseEvent.timestamp;
                  writer.writeStreamEvent(sseEvent, operationId);
                  timing(
                    '[%s:%d] SSE sent %s, original timestamp %d, sent at %d, total latency %dms',
                    operationId,
                    event.stepIndex,
                    event.type,
                    sseEvent.timestamp,
                    now,
                    totalLatency,
                  );

                  // 如果收到 agent_runtime_end 事件，立即终止流
                  if (event.type === 'agent_runtime_end') {
                    log(
                      `Agent runtime ended for operation ${operationId}, terminating stream immediately`,
                    );

                    // Mark stream as ended to prevent any more events
                    streamEnded = true;

                    // Immediately cleanup and close connection
                    cleanup();
                    controller.close();
                    log(
                      `SSE connection closed after agent runtime end for operation ${operationId}`,
                    );
                  }
                } catch (error) {
                  console.error('[Agent Stream] Error sending event:', error);
                }
              });
            },
            abortController.signal,
          );
        } catch (error) {
          if (!abortController.signal.aborted) {
            console.error('[Agent Stream] Subscription error:', error);

            try {
              writer.writeError(error as Error, operationId, 'stream_subscription');
            } catch (controllerError) {
              console.error('[Agent Stream] Failed to send subscription error:', controllerError);
            }
          }
        }
      };

      // 开始订阅
      subscribeToEvents();

      // 监听连接关闭
      request.signal?.addEventListener('abort', cleanup);

      // 存储清理函数以便在 cancel 时调用
      (controller as any)._cleanup = cleanup;
    },
  });

  // 设置 SSE 响应头
  return new Response(stream, {
    headers: createSSEHeaders(),
  });
}
