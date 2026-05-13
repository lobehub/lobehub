import { createSSEHeaders, createSSEWriter } from '@lobechat/utils/server';
import debug from 'debug';

import { createStreamEventManager } from '@/server/modules/AgentRuntime';

const log = debug('api-route:agent:stream');
const timing = debug('lobe-server:agent-runtime:timing');

export const agentStreamAPIHandler = async (request: Request) => {
  const streamManager = createStreamEventManager();

  const { searchParams } = new URL(request.url);
  const operationId = searchParams.get('operationId');
  const lastEventId = searchParams.get('lastEventId') || '0';
  const includeHistory = searchParams.get('includeHistory') === 'true';

  if (!operationId) {
    return Response.json(
      {
        error: 'operationId parameter is required',
      },
      { status: 400 },
    );
  }

  log(`Starting SSE connection for operation ${operationId} from eventId ${lastEventId}`);

  let cleanup: (() => void) | undefined;

  const stream = new ReadableStream({
    cancel(reason) {
      log(`SSE connection cancelled for operation ${operationId}:`, reason);
      cleanup?.();
    },

    start(controller) {
      const writer = createSSEWriter(controller);

      writer.writeConnection(operationId, lastEventId);
      log(`SSE connection established for operation ${operationId}`);

      if (includeHistory) {
        streamManager
          .getStreamHistory(operationId, 50)
          .then((history) => {
            const sortedHistory = history.reverse();

            sortedHistory.forEach((event) => {
              if (!lastEventId || lastEventId === '0' || event.timestamp.toString() > lastEventId) {
                try {
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

      const abortController = new AbortController();
      let streamEnded = false;

      const heartbeatInterval = setInterval(() => {
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

      const closeStream = () => {
        abortController.abort();
        clearInterval(heartbeatInterval);
        log(`SSE connection closed for operation ${operationId}`);
      };

      const subscribeToEvents = async () => {
        try {
          await streamManager.subscribeStreamEvents(
            operationId,
            lastEventId,
            (events) => {
              events.forEach((event) => {
                if (streamEnded) {
                  return;
                }

                try {
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

                  if (event.type === 'agent_runtime_end') {
                    log(
                      `Agent runtime ended for operation ${operationId}, terminating stream immediately`,
                    );

                    streamEnded = true;
                    closeStream();
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

      subscribeToEvents();

      request.signal?.addEventListener('abort', closeStream);
      cleanup = closeStream;
    },
  });

  return new Response(stream, {
    headers: createSSEHeaders(),
  });
};
