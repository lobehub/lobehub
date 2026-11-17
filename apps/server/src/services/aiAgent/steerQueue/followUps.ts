import { randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import debug from 'debug';

import type { LobeChatDatabase } from '@/database/type';
import { resolveAgentSender } from '@/server/services/aiAgent/agentSenderResolver';
import {
  AgentRelayHopLimitError,
  assertAgentRelayHop,
} from '@/server/services/aiAgent/sourceAttribution';
import { redisService } from '@/server/services/redis';
import {
  type SteerQueueScope,
  SteerQueueWriteUnknownError,
} from '@/server/services/redis/steerQueue';

import type { QueuedFollowUp, QueuedFollowUpRequest } from './index';
import { findOwnLiveRuns, isRunAlive } from './liveRuns';

const log = debug('lobe-server:steer-queue');

/**
 * Who is queueing. Callers authorize the agent and the conversation before
 * calling in; these helpers only run the queue protocol.
 */
export interface FollowUpQueueContext {
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
}

export interface QueueFollowUpParams {
  audit?: QueuedFollowUp['audit'];
  composer?: QueuedFollowUp['composer'];
  /** Client-minted entry id; a retry with the same id appends at most once. */
  id?: string;
  /** The fresh-send request, already folded and stripped of branch-only fields. */
  request: QueuedFollowUpRequest;
  scope: SteerQueueScope;
  /** Another agent queueing through `lh topic send`; resolved into the sender now. */
  sourceOperationId?: string;
}

export type QueueFollowUpResult =
  | { queued: false; reason: 'full' | 'idle' | 'unavailable' }
  | { id: string; length: number; queued: true; state: 'delivering' | 'queued' | 'taken' };

/**
 * Queue a follow-up behind the newest own live run on the conversation.
 *
 * `queued: false` means nothing was stored and the caller should send the
 * message itself: no own run is live (`idle`), the queue is at its bound
 * (`full`), or the follow-up could not be stored (`unavailable`). A
 * `SERVICE_UNAVAILABLE` error means the outcome is unknown: retry with the
 * same `id`.
 */
export const queueFollowUp = async (
  ctx: FollowUpQueueContext,
  params: QueueFollowUpParams,
): Promise<QueueFollowUpResult> => {
  const { scope, sourceOperationId, request } = params;

  // A retry of an append whose answer was lost: what the server already holds
  // decides, before liveness — the run may have ended since, but the entry is
  // still delivered (or was), so the client must never send it too.
  if (params.id) {
    const state = await redisService.steerQueue.entryState(scope, params.id);
    // Redis cannot be read: an earlier try may be stored, and the run may
    // have ended since — neither "queued" nor "send directly".
    if (!state) throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'Queue unavailable' });
    if (state === 'queued') return { id: params.id, length: 1, queued: true, state: 'queued' };
    if (state === 'delivering' || state === 'taken')
      return { id: params.id, length: 0, queued: true, state };
  }
  const liveRuns = await findOwnLiveRuns({ db: ctx.db, workspaceId: ctx.workspaceId }, scope);
  if (liveRuns.length === 0) return { queued: false, reason: 'idle' };
  // More than one run can look live: a finished run keeps its row `running`
  // until its last step commits, and thread starts are not serialized. The
  // user types behind the newest one (the list is newest first); an older
  // run that ends later leaves entries bound to a live run alone.
  const [behindOperationId] = liveRuns;

  // Resolved now, while the sending run is still in flight to vouch for it:
  // the follow-up usually starts after that run has settled.
  const agentSender =
    sourceOperationId && request.agentId
      ? await resolveAgentSender(
          { db: ctx.db, userId: ctx.userId, workspaceId: ctx.workspaceId },
          { destinationAgentId: request.agentId, sourceOperationId },
        )
      : undefined;
  try {
    assertAgentRelayHop(agentSender);
  } catch (error) {
    if (!(error instanceof AgentRelayHopLimitError)) throw error;
    throw new TRPCError({ cause: error, code: 'TOO_MANY_REQUESTS', message: error.message });
  }

  const entry: QueuedFollowUp = {
    agentSender,
    audit: params.audit,
    composer: params.composer,
    createdAt: Date.now(),
    id: params.id ?? randomUUID(),
    request,
    userId: ctx.userId,
  };

  let length: Awaited<ReturnType<typeof redisService.steerQueue.append>>;
  try {
    length = await redisService.steerQueue.append(scope, entry, behindOperationId);
  } catch (error) {
    if (!(error instanceof SteerQueueWriteUnknownError)) throw error;
    // Neither "queued" nor "send directly" is safe to answer; the client
    // retries with the same entry id, which appends at most once.
    throw new TRPCError({ cause: error, code: 'SERVICE_UNAVAILABLE', message: error.message });
  }
  // Taken back after its command failed: definitely not stored.
  if (length === 'notStored') return { queued: false, reason: 'unavailable' };
  // Redis is a deployment requirement, so no client is an outage: an earlier
  // try of this id may have been stored. Unknown — the client keeps it the
  // server's and retries the same id.
  if (length === undefined)
    throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'Queue unavailable' });
  if (length === 'full') return { queued: false, reason: 'full' };
  // A retry of a write that landed and was already taken by its run: it is
  // on its way, so the client must not send it again.
  if (length === 'taken') return { id: entry.id, length: 0, queued: true, state: 'taken' };

  // The run may have ended between the check above and the append, after its
  // drain: then nothing would ever start this entry. Take it back and let the
  // client send it. If the take-back loses, a drain already started it.
  if (
    !(await isRunAlive({ db: ctx.db, workspaceId: ctx.workspaceId }, ctx.userId, behindOperationId))
  ) {
    const removed = await redisService.steerQueue.remove(scope, entry.id);
    if (removed) return { queued: false, reason: 'idle' };
  }

  log(
    'append: topic=%s thread=%s id=%s length=%d',
    scope.topicId,
    scope.threadId,
    entry.id,
    length,
  );
  return { id: entry.id, length, queued: true, state: 'queued' };
};

export interface ListedFollowUp {
  createdAt: number;
  delivering: boolean;
  editorData?: Record<string, unknown>;
  fileIds?: string[];
  filesPreview?: Record<string, unknown>[];
  id: string;
  mentionedAgents?: QueuedFollowUpRequest['mentionedAgents'];
  prompt: string;
  selectedSkillIds?: QueuedFollowUpRequest['selectedSkillIds'];
  selectedToolIds?: QueuedFollowUpRequest['selectedToolIds'];
}

/**
 * The caller's follow-ups on a conversation that are not delivered yet, oldest
 * first. `delivering` ones were taken by a run that has not confirmed them:
 * they cannot be withdrawn, and come back as waiting should the delivery fail.
 */
export const listFollowUps = async (scope: SteerQueueScope): Promise<ListedFollowUp[]> => {
  let snapshot: { delivering: QueuedFollowUp[]; waiting: QueuedFollowUp[] };
  try {
    snapshot = await redisService.steerQueue.snapshot<QueuedFollowUp>(scope);
  } catch (error) {
    // Unknown, not empty: a client must keep what it shows as queued.
    throw new TRPCError({
      cause: error,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Queue unavailable',
    });
  }
  const { delivering, waiting } = snapshot;
  const own = (entry: QueuedFollowUp) => entry.userId === scope.userId;
  const waitingIds = new Set(waiting.map((entry) => entry.id));
  return [
    ...waiting.filter(own).map((entry) => ({ entry, delivering: false })),
    // An entry returned to the queue mid-read is listed once, as waiting.
    ...delivering
      .filter((entry) => own(entry) && !waitingIds.has(entry.id))
      .map((entry) => ({ entry, delivering: true })),
  ]
    .sort((a, b) => a.entry.createdAt - b.entry.createdAt)
    .map(({ entry, delivering: isDelivering }) => ({
      createdAt: entry.createdAt,
      delivering: isDelivering,
      editorData: entry.composer?.editorData,
      fileIds: entry.request.fileIds,
      filesPreview: entry.composer?.filesPreview,
      id: entry.id,
      mentionedAgents: entry.request.mentionedAgents,
      prompt: entry.request.prompt,
      selectedSkillIds: entry.request.selectedSkillIds,
      selectedToolIds: entry.request.selectedToolIds,
    }));
};

/**
 * Withdraw a queued follow-up, in one step with reading where it is:
 * `removed`, or why not — `delivering` (a run took it and has not settled; it
 * may still come back), `taken` (delivered) or `absent` (never stored). The
 * queue is the caller's own, so only their follow-ups can be withdrawn.
 */
export const removeFollowUp = async (scope: SteerQueueScope, id: string) => {
  const state = await redisService.steerQueue.entryState(scope, id, { remove: true });
  // Without Redis nothing is known: it may still be delivered, so it must
  // neither read as withdrawn nor be resent.
  if (!state) throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'Queue unavailable' });
  return { removed: state === 'removed', state };
};
