import { createSSEHeaders, createSSEWriter } from '@lobechat/utils/server';
import debug from 'debug';
import { NextResponse } from 'next/server';

import { checkAuth, type RequestHandler } from '@/app/(backend)/middleware/auth';
import {
  AgentOperationModel,
  type AgentOperationOwnerScope,
} from '@/database/models/agentOperation';
import { createStreamEventManager } from '@/server/modules/AgentRuntime';

const log = debug('api-route:agent:stream');
const timing = debug('lobe-server:agent-runtime:timing');

/**
 * Server-Sent Events (SSE) endpoint
 * Provides real-time Agent execution event stream for clients
 */
const handler: RequestHandler = async (request, { serverDB, userId, workspaceId }) => {
  // Initialize stream event manager (uses InMemory singleton in local dev, Redis in production)
  const streamManager = createStreamEventManager();

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

  // Prefer the durable audit row, but runtime startup deliberately tolerates a
  // failed audit insert. The stream backend keeps the same minimal scope as a
  // trusted live-operation fallback (shared through Redis in distributed mode).
  let operation: AgentOperationOwnerScope | null = null;
  try {
    operation = await AgentOperationModel.findOwnerScope(serverDB, operationId);
  } catch (error) {
    log(`Failed to read durable ownership for operation ${operationId}:`, error);
  }
  operation ??= await streamManager.getOperationAuthScope(operationId);

  // A workspace API key represents the validated workspace, not only the user
  // who created it, so any operation in that workspace is in scope. Personal
  // keys remain restricted to the caller's personal operations.
  const isApiKeyRequest = !!request.headers.get('X-API-Key')?.trim();
  const apiKeyWorkspaceId = workspaceId?.trim() || null;
  const isAuthorized = isApiKeyRequest
    ? apiKeyWorkspaceId
      ? operation?.workspaceId === apiKeyWorkspaceId
      : operation?.workspaceId === null && operation.userId === userId
    : operation?.userId === userId;

  if (!isAuthorized) {
    return NextResponse.json(
      { error: 'Forbidden: operation does not belong to this authentication scope' },
      { status: 403 },
    );
  }

  log(`Starting SSE connection for operation ${operationId} from eventId ${lastEventId}`);

  // Create Server-Sent Events stream
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

      // Send connection confirmation event
      writer.writeConnection(operationId, lastEventId);
      log(`SSE connection established for operation ${operationId}`);

      // If needed, send historical events first
      if (includeHistory) {
        streamManager
          .getStreamHistory(operationId, 50)
          .then((history) => {
            // Send historical events in chronological order (earliest first)
            const sortedHistory = history.reverse();

            sortedHistory.forEach((event) => {
              // Only send events newer than lastEventId
              if (!lastEventId || lastEventId === '0' || event.timestamp.toString() > lastEventId) {
                try {
                  // Add SSE-specific fields, keeping format consistent with real-time events
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

      // Create AbortController for canceling subscription
      const abortController = new AbortController();

      // Track if stream has ended (agent_runtime_end received)
      // Once set to true, no more events will be sent
      let streamEnded = false;

      // Send heartbeat periodically (every 30 seconds)
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

      // Subscribe to new streaming events
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
                  // Add SSE-specific fields
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

                  // If agent_runtime_end event is received, terminate stream immediately
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

      // Start subscription
      subscribeToEvents();

      // Listen for connection close
      request.signal?.addEventListener('abort', cleanup);

      // Store cleanup function for calling during cancel
      (controller as any)._cleanup = cleanup;
    },
  });

  // Set SSE response headers
  return new Response(stream, {
    headers: createSSEHeaders(),
  });
};

export const GET = checkAuth(handler, { allowApiKey: true });
