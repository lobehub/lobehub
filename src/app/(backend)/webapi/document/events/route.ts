import { createSSEHeaders, createSSEWriter } from '@lobechat/utils/server';
import debug from 'debug';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { DocumentService } from '@/server/services/document';
import { subscribeResourceEvents } from '@/server/services/resourceEvents';

import { resolveValidWorkspaceIdFromRequest } from '../../_utils/workspace';

const log = debug('api-route:document:events');

// Long-lived SSE; rely on client auto-reconnect + the lock heartbeat across this boundary.
export const maxDuration = 300;
// ioredis (the event transport) requires the Node runtime, not Edge.
export const runtime = 'nodejs';

const jsonError = (message: string, status: number) =>
  new Response(JSON.stringify({ error: message }), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });

/**
 * Realtime event stream for a single workspace document. Pushes `doc.updated`
 * and `lock.changed` events so an open editor (including pure viewers) syncs
 * near-instantly instead of waiting for the polling heartbeat.
 */
export const GET = checkAuth(async (req, { userId, serverDB }) => {
  const documentId = new URL(req.url).searchParams.get('documentId');
  if (!documentId) return jsonError('documentId is required', 400);

  // Access: must be an active member of the (header) workspace...
  const workspaceId = await resolveValidWorkspaceIdFromRequest({ req, serverDB, userId });
  if (!workspaceId) return jsonError('workspace access required', 403);

  // ...and the document must be visible within that workspace (findById is
  // workspace-scoped), so a member can't subscribe to a doc outside their scope.
  const doc = await new DocumentService(serverDB, userId, workspaceId).getDocumentById(documentId);
  if (!doc) return jsonError('document not found', 404);

  const ref = { id: documentId, type: 'document' as const };

  const stream = new ReadableStream<string>({
    cancel() {
      (this as unknown as { _cleanup?: () => void })._cleanup?.();
    },
    start(controller) {
      const writer = createSSEWriter(controller);
      writer.writeConnection(documentId, '$');

      const ac = new AbortController();
      const heartbeat = setInterval(() => {
        try {
          writer.writeHeartbeat();
        } catch {
          clearInterval(heartbeat);
        }
      }, 30_000);

      const cleanup = () => {
        ac.abort();
        clearInterval(heartbeat);
      };

      void subscribeResourceEvents(
        ref,
        (event) => {
          try {
            writer.writeStreamEvent(event);
          } catch (error) {
            log('failed to write event %O', error);
          }
        },
        ac.signal,
      ).catch((error) => {
        if (!ac.signal.aborted) log('subscription error %O', error);
      });

      req.signal?.addEventListener('abort', cleanup);
      (controller as unknown as { _cleanup?: () => void })._cleanup = cleanup;
    },
  });

  return new Response(stream, { headers: createSSEHeaders() });
});
