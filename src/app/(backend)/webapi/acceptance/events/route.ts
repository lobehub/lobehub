import { createSSEHeaders, createSSEWriter } from '@lobechat/utils/server';
import debug from 'debug';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { subscribeResourceEvents } from '@/server/services/resourceEvents';
import {
  AcceptanceService,
  releaseAcceptanceWatcher,
  renewAcceptanceWatcher,
} from '@/server/services/verify';

import { resolveValidWorkspaceIdFromRequest, WORKSPACE_ID_HEADER } from '../../_utils/workspace';

const log = debug('api-route:acceptance:events');

export const maxDuration = 300;
export const runtime = 'nodejs';

const jsonError = (message: string, status: number) =>
  new Response(JSON.stringify({ error: message }), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });

/**
 * One-shot acceptance watch stream. It remains quiet except for connection /
 * heartbeat frames, then emits exactly one terminal domain event and closes.
 * The CLI refetches the canonical bundle after that signal.
 */
export const GET = checkAuth(async (req, { userId, serverDB }) => {
  const url = new URL(req.url);
  const acceptanceId = url.searchParams.get('id')?.trim();
  if (!acceptanceId) return jsonError('id is required', 400);

  const requestedWorkspaceId = req.headers.get(WORKSPACE_ID_HEADER)?.trim();
  const workspaceId = await resolveValidWorkspaceIdFromRequest({ req, serverDB, userId });
  if (requestedWorkspaceId && !workspaceId) return jsonError('workspace access required', 403);

  const service = new AcceptanceService(serverDB, userId, workspaceId);
  const acceptance = await service.acceptanceModel.findById(acceptanceId);
  if (!acceptance) return jsonError('acceptance not found', 404);

  const requestedRound = url.searchParams.get('round');
  const parsedRound = requestedRound === null ? undefined : Number(requestedRound);
  if (parsedRound !== undefined && (!Number.isInteger(parsedRound) || parsedRound < 1)) {
    return jsonError('round must be a positive integer', 400);
  }

  const initialRounds = (await service.loadRounds(acceptanceId)).runs;
  const roundIndex = parsedRound ?? initialRounds.at(-1)?.roundIndex;
  if (!roundIndex || !initialRounds.some((run) => run.roundIndex === roundIndex)) {
    return jsonError('acceptance round not found', 404);
  }

  const ref = { id: acceptanceId, type: 'acceptance' as const };
  const watcherId = crypto.randomUUID();
  let cleanup = () => {};

  const stream = new ReadableStream<string>({
    cancel() {
      cleanup();
    },
    async start(controller) {
      const writer = createSSEWriter(controller);
      const abort = new AbortController();
      let cleaned = false;
      let finished = false;

      const finish = (type: 'acceptance.accepted' | 'acceptance.feedbackSubmitted') => {
        if (finished) return;
        finished = true;
        writer.writeEvent({ data: { roundIndex, type }, event: type });
        cleanup();
        controller.close();
      };

      const reconcile = async () => {
        if (finished) return;
        try {
          const currentAcceptance = await service.acceptanceModel.findById(acceptanceId);
          if (currentAcceptance?.status === 'accepted') {
            finish('acceptance.accepted');
            return;
          }

          const target = (await service.loadRounds(acceptanceId)).runs.find(
            (run) => run.roundIndex === roundIndex,
          );
          if (target?.decisionDetail?.feedbackSubmittedAt) {
            finish('acceptance.feedbackSubmitted');
          }
        } catch (error) {
          log('reconciliation failed for %s r%d %O', acceptanceId, roundIndex, error);
        }
      };

      await renewAcceptanceWatcher(acceptanceId, roundIndex, watcherId);
      writer.writeConnection(acceptanceId, '$');

      const heartbeat = setInterval(() => {
        if (finished) return;
        try {
          writer.writeHeartbeat();
        } catch {
          cleanup();
          return;
        }
        void renewAcceptanceWatcher(acceptanceId, roundIndex, watcherId);
        void reconcile();
      }, 30_000);

      cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        finished = true;
        if (!abort.signal.aborted) abort.abort();
        clearInterval(heartbeat);
        req.signal.removeEventListener('abort', cleanup);
        void releaseAcceptanceWatcher(acceptanceId, roundIndex, watcherId);
      };

      void subscribeResourceEvents(
        ref,
        (event) => {
          if (event.type === 'acceptance.accepted') {
            finish('acceptance.accepted');
            return;
          }
          if (
            event.type === 'acceptance.feedbackSubmitted' &&
            event.data?.roundIndex === roundIndex
          ) {
            finish('acceptance.feedbackSubmitted');
          }
        },
        abort.signal,
      ).catch((error) => {
        if (!abort.signal.aborted) log('subscription error %O', error);
      });

      req.signal.addEventListener('abort', cleanup, { once: true });
      await reconcile();
    },
  });

  return new Response(stream, { headers: createSSEHeaders() });
});
