import { createSSEHeaders, createSSEWriter } from '@lobechat/utils/server';
import { TRPCError } from '@trpc/server';
import debug from 'debug';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { assertTopicCommentReadAccess } from '@/server/routers/lambda/_helpers/topicCommentAccess';
import { subscribeResourceEvents } from '@/server/services/resourceEvents';

import { resolveValidWorkspaceIdFromRequest } from '../../_utils/workspace';

const log = debug('api-route:topic-comment:events');

export const maxDuration = 300;
export const runtime = 'nodejs';

const jsonError = (message: string, status: number) =>
  new Response(JSON.stringify({ error: message }), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });

export const GET = checkAuth(async (req, { userId, serverDB }) => {
  const topicId = new URL(req.url).searchParams.get('topicId');
  if (!topicId) return jsonError('topicId is required', 400);

  const workspaceId = await resolveValidWorkspaceIdFromRequest({ req, serverDB, userId });
  if (!workspaceId) return jsonError('resource not found', 404);

  try {
    await assertTopicCommentReadAccess({
      db: serverDB,
      hideExistence: true,
      topicId,
      userId,
      workspaceId,
    });
  } catch (error) {
    if (error instanceof TRPCError && ['FORBIDDEN', 'NOT_FOUND'].includes(error.code)) {
      return jsonError('resource not found', 404);
    }
    throw error;
  }

  let cleanup: (() => void) | undefined;
  const stream = new ReadableStream<string>({
    cancel() {
      cleanup?.();
    },
    start(controller) {
      const writer = createSSEWriter(controller);
      writer.writeConnection(topicId, '$');
      const ac = new AbortController();
      let checkingAccess = false;
      const stop = () => {
        if (ac.signal.aborted) return;
        ac.abort();
        clearInterval(heartbeat);
        req.signal?.removeEventListener('abort', stop);
        try {
          controller.close();
        } catch {
          // The client may already have cancelled or closed the stream.
        }
      };
      cleanup = stop;
      const heartbeat = setInterval(() => {
        if (checkingAccess || ac.signal.aborted) return;
        checkingAccess = true;
        void assertTopicCommentReadAccess({
          db: serverDB,
          hideExistence: true,
          topicId,
          userId,
          workspaceId,
        })
          .then(() => {
            if (!ac.signal.aborted) writer.writeHeartbeat();
          })
          .catch((error) => {
            log('closing stream after access revalidation failed %O', error);
            stop();
          })
          .finally(() => {
            checkingAccess = false;
          });
      }, 30_000);

      void subscribeResourceEvents(
        { id: topicId, type: 'topic' },
        (event) => {
          if (ac.signal.aborted) return;
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

      req.signal?.addEventListener('abort', stop, { once: true });
    },
  });

  return new Response(stream, { headers: createSSEHeaders() });
});
