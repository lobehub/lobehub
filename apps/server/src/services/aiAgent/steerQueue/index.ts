import { randomUUID } from 'node:crypto';

import type { AgentSenderMetadata, ComposerUserMessage, MessageMetadata } from '@lobechat/types';
import { COMPOSER_USER_MESSAGE_METADATA_KEYS, toComposerUserMessage } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';

import { assertCanUseWorkspaceAgent } from '@/server/routers/lambda/_helpers/workspaceAgentGuard';
import { foldLegacyUserMessageFields } from '@/server/routers/lambda/aiAgent/execSchemas';
import { assertCanUseAgentRunConversation } from '@/server/routers/lambda/aiAgent/guards';
import { redisService } from '@/server/services/redis';
import type { SteerQueueEntry, SteerQueueScope } from '@/server/services/redis/steerQueue';

import { type ComposerRunContext, type ComposerRunRequest, startComposerRun } from '../composerRun';
import { findOwnLiveRuns, isRunAlive } from './liveRuns';

const log = debug('lobe-server:steer-queue');

/**
 * The part of a composer send a queued follow-up keeps: a fresh message typed
 * into a running conversation. Resume, regenerate and supersede fields have no
 * meaning for a turn that starts later, so they are never stored.
 */
export type QueuedFollowUpRequest = Omit<
  ComposerRunRequest,
  | 'autoStart'
  | 'clientOperations'
  | 'existingMessageIds'
  | 'includeFinalState'
  | 'parentMessageId'
  | 'queuedSuccessor'
  | 'replacesOperationId'
  | 'requireDevice'
  | 'resumeApproval'
  | 'resumeApprovals'
  | 'resumeToolResult'
  | 'sourceOperationId'
  | 'steer'
  | 'title'
>;

export interface QueuedFollowUp extends SteerQueueEntry {
  /**
   * The sending agent, when another agent queued this (`lh topic send` into a
   * busy conversation). Resolved by the server when it was queued: by the time
   * the follow-up starts, the sending run has usually settled and can no longer
   * vouch for it.
   */
  agentSender?: AgentSenderMetadata;
  /** Server-derived provenance of the request that queued it. */
  audit?: { clientIp?: string; userAgent?: string };
  /**
   * The composer state the follow-up was sent from, opaque to the server, so a
   * client that reloads can show and resend it exactly as typed (selections,
   * mentions). Never used to run it.
   */
  composer?: { editorData?: Record<string, unknown>; filesPreview?: Record<string, unknown>[] };
  request: QueuedFollowUpRequest;
  /** Who queued it; only the run owner's own follow-ups are started for them. */
  userId: string;
}

const uniq = <T>(items: T[]) => [...new Set(items)];

/**
 * Every follow-up's attached content is kept, in queue order. Rich text belongs
 * to one message's text, so it survives only when a single follow-up is sent:
 * a merged send's text is the joined prompts.
 */
const mergeComposerUserMessages = (
  messages: (ComposerUserMessage | undefined)[],
): ComposerUserMessage | undefined => {
  const metadata: Record<string, unknown[]> = {};
  for (const key of COMPOSER_USER_MESSAGE_METADATA_KEYS) {
    const values = messages.flatMap((message): unknown[] => message?.metadata?.[key] ?? []);
    if (values.length) metadata[key] = values;
  }
  const editorData = messages.length === 1 ? messages[0]?.editorData : undefined;

  return toComposerUserMessage({ editorData, metadata: metadata as MessageMetadata });
};

/**
 * Fold every waiting follow-up into one request, the way the client merges its
 * own queue: the texts in queue order, every attachment and selection kept.
 * The newest entry decides the run settings (model, device, approvals), since
 * that is what the user last had selected when they queued.
 */
export const mergeQueuedFollowUps = (entries: QueuedFollowUp[]): QueuedFollowUpRequest => {
  const sorted = [...entries].sort((a, b) => a.createdAt - b.createdAt);
  const latest = sorted.at(-1)!.request;

  const fileIds = uniq(sorted.flatMap((entry) => entry.request.fileIds ?? []));
  const selectedSkillIds = uniq(sorted.flatMap((entry) => entry.request.selectedSkillIds ?? []));
  const selectedToolIds = uniq(sorted.flatMap((entry) => entry.request.selectedToolIds ?? []));
  const mentionedAgents = [
    ...new Map(
      sorted.flatMap((entry) => entry.request.mentionedAgents ?? []).map((a) => [a.id, a]),
    ).values(),
  ];

  return {
    ...latest,
    // Client-minted row ids belong to one optimistic send; a merged send
    // creates rows none of the queued sends announced.
    clientIds: sorted.length === 1 ? latest.clientIds : undefined,
    fileIds: fileIds.length ? fileIds : undefined,
    mentionedAgents: mentionedAgents.length ? mentionedAgents : undefined,
    prompt: sorted.map((entry) => entry.request.prompt).join('\n\n'),
    selectedSkillIds: selectedSkillIds.length ? selectedSkillIds : undefined,
    selectedToolIds: selectedToolIds.length ? selectedToolIds : undefined,
    userMessage: mergeComposerUserMessages(sorted.map((entry) => entry.request.userMessage)),
  };
};

const senderKey = (entry: QueuedFollowUp) =>
  entry.agentSender
    ? [entry.agentSender.agentId, entry.agentSender.topicId, entry.agentSender.threadId].join('|')
    : '';

/**
 * Split off the leading follow-ups that share one author — the person, or one
 * sending agent's conversation. Merged follow-ups become one user message with
 * one author, so an agent's message must not be folded into the person's (it
 * would read as typed by them) nor into another agent's (the reply would go to
 * only one of them). The rest wait for the next turn.
 */
export const takeSameSenderFollowUps = (
  entries: QueuedFollowUp[],
): { agentSender?: AgentSenderMetadata; rest: QueuedFollowUp[]; taken: QueuedFollowUp[] } => {
  const sorted = [...entries].sort((a, b) => a.createdAt - b.createdAt);
  if (sorted.length === 0) return { rest: [], taken: [] };
  const key = senderKey(sorted[0]);
  const firstOther = sorted.findIndex((entry) => senderKey(entry) !== key);
  const taken = firstOther === -1 ? sorted : sorted.slice(0, firstOther);

  return {
    agentSender: sorted[0].agentSender,
    rest: sorted.slice(taken.length),
    taken,
  };
};

/** Guard outcomes that mean the user may no longer start this turn. */
const DENIED_CODES = new Set<TRPCError['code']>(['FORBIDDEN', 'NOT_FOUND']);

/**
 * A drained batch: the follow-ups a run took, held in Redis under `drainId`
 * until the run acknowledges or returns them (see `steerQueue.settle`).
 */
export interface DrainedFollowUps {
  drainId: string;
  entries: QueuedFollowUp[];
}

/**
 * Some or all drained follow-ups did not go anywhere: put them back at the
 * head of the queue, unbound. Never throws — if Redis cannot be reached the
 * batch goes back on its own once its lease lapses.
 */
export const returnFollowUps = async (
  scope: SteerQueueScope,
  drained: Pick<DrainedFollowUps, 'drainId'>,
  entries: QueuedFollowUp[],
  reason: unknown,
) => {
  if (entries.length === 0) return;
  console.error(
    '[steerQueue] %d queued follow-ups go back to the queue: %O',
    entries.length,
    reason,
  );
  await redisService.steerQueue
    .settle(
      scope,
      drained.drainId,
      entries.map((entry) => entry.id),
    )
    .catch((error) => {
      console.error(
        '[steerQueue] returning %d follow-ups for topic %s failed; they return when batch %s lapses: %O',
        entries.length,
        scope.topicId,
        drained.drainId,
        error,
      );
    });
};

/**
 * The drained batch reached its destination (or was dropped): acknowledge it.
 * Never throws — an unacknowledged batch lapses back into the queue, which
 * would only redeliver it.
 */
export const ackFollowUps = async (
  scope: SteerQueueScope,
  drained: Pick<DrainedFollowUps, 'drainId'>,
) => {
  await redisService.steerQueue.settle(scope, drained.drainId).catch((error) => {
    console.error('[steerQueue] acknowledging batch %s failed: %O', drained.drainId, error);
  });
};

/**
 * Take the follow-ups `operationId` owns — queued behind it, returned unbound
 * after a failed delivery, or orphaned by a run that ended while Redis was out
 * of reach — into a drained batch. Another live run on the surface keeps its
 * own. The queue is the run owner's (the scope carries their user id); a
 * foreign entry is never acted on under this user's authority if one got here.
 *
 * A drain whose response was lost is read back once with the same id; if that
 * fails too, the batch (if it was taken) goes back when its lease lapses.
 *
 * @throws when Redis is unavailable: the entries stay queued
 */
export const drainOwnFollowUps = async (
  ctx: Pick<ComposerRunContext, 'db' | 'userId' | 'workspaceId'>,
  scope: SteerQueueScope,
  operationId: string,
): Promise<DrainedFollowUps> => {
  const drainId = randomUUID();
  const { operationIds, total } = await redisService.steerQueue.boundOperations(scope);
  if (total === 0) return { drainId, entries: [] };

  // Entries behind another run are left to it unless that run is confirmed
  // ended — checked one by one, so a run that starts meanwhile (and the
  // follow-ups queued behind it) is never mistaken for an orphan.
  const ended: string[] = [];
  for (const id of operationIds) {
    if (id !== operationId && !(await isRunAlive(ctx, ctx.userId, id))) ended.push(id);
  }
  const drain = () =>
    redisService.steerQueue.drain<QueuedFollowUp>(scope, operationId, ended, drainId);
  const drained = await drain().catch((error) => {
    log('[%s] Drain %s failed, reading it back once: %O', operationId, drainId, error);
    return drain();
  });

  const entries = drained
    .filter((entry) => entry.userId === ctx.userId)
    // Entries queued before `userMessage` existed (they live in Redis across a
    // deploy) still carry the top-level selection fields; read them as one shape.
    .map((entry) => ({ ...entry, request: foldLegacyUserMessageFields(entry.request) }));
  if (entries.length < drained.length) {
    // Acknowledged along with the rest of the batch; never sent.
    log('[%s] Dropped %d foreign queued follow-ups', operationId, drained.length - entries.length);
  }
  if (entries.length === 0 && drained.length > 0) await ackFollowUps(scope, { drainId });
  return { drainId, entries };
};

/**
 * `append` authorized a follow-up when it was queued; access can be revoked
 * while the run is still going. Re-check it the way `aiAgent.execAgent` checks
 * every run. `denied` means the follow-ups are no longer this user's to send —
 * putting them back would only retry a refused send; any other failure of the
 * check says nothing about access and is thrown.
 */
export const checkFollowUpAccess = async (
  ctx: Pick<ComposerRunContext, 'db' | 'userId' | 'workspaceId'>,
  request: QueuedFollowUpRequest,
  scope: SteerQueueScope,
): Promise<'allowed' | 'denied'> => {
  try {
    await assertCanUseWorkspaceAgent({
      agentId: request.agentId,
      db: ctx.db,
      groupId: request.appContext?.groupId,
      slug: request.slug,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });
    await assertCanUseAgentRunConversation({
      db: ctx.db,
      topicId: scope.topicId,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });
    return 'allowed';
  } catch (error) {
    if (error instanceof TRPCError && DENIED_CODES.has(error.code)) return 'denied';
    throw error;
  }
};

/**
 * A top-level run just finished on `scope`: start the follow-ups still queued
 * behind it as the next turn, here on the server, instead of waiting for a
 * client to drain them. A native run takes most follow-ups into itself before
 * its next LLM call (`injectQueuedFollowUp`); this picks up the rest — those
 * that arrived after its last decision point or could not join a running turn —
 * and serves heterogeneous agents (Claude Code, Codex) when they finish.
 *
 * Drain is atomic, so exactly one finishing run takes a given follow-up. When
 * the next turn cannot start, the follow-ups go back to the head of the queue —
 * the next run that ends picks them up, and the client can still list them.
 * When the user lost access to the agent or conversation meanwhile, they are
 * dropped instead.
 *
 * @returns the started operation, or `undefined` when nothing was queued or the
 * start failed
 */
export const startQueuedFollowUp = async (
  ctx: ComposerRunContext,
  params: { operationId: string; scope: SteerQueueScope },
): Promise<{ operationId: string } | undefined> => {
  const { scope } = params;

  const drained = await drainOwnFollowUps(ctx, scope, params.operationId);
  if (drained.entries.length === 0) return;

  // One author per turn; the run this starts picks the others up when it ends.
  const { agentSender, rest, taken: entries } = takeSameSenderFollowUps(drained.entries);
  await returnFollowUps(scope, drained, rest, 'sent by another author');

  const request = mergeQueuedFollowUps(entries);
  const audit = entries.at(-1)!.audit;

  try {
    if ((await checkFollowUpAccess(ctx, request, scope)) === 'denied') {
      console.error(
        '[startQueuedFollowUp] dropped %d queued follow-ups after %s: access revoked',
        entries.length,
        params.operationId,
      );
      await ackFollowUps(scope, drained);
      return;
    }

    // The topic was free for a moment between the finished run and this
    // start; a send the user made in that gap now owns the surface. Never
    // interrupt it: the follow-ups go back, unbound, and that run takes them.
    const others = (await findOwnLiveRuns(ctx, scope)).filter((id) => id !== params.operationId);
    if (others.length > 0) {
      await returnFollowUps(scope, drained, entries, `left to live run ${others[0]}`);
      return;
    }
  } catch (error) {
    await returnFollowUps(scope, drained, entries, error);
    return;
  }

  try {
    const result = await startComposerRun(
      // Not superseding: should a send still win the surface before this start
      // claims it, the start fails and the follow-ups go back to the queue.
      { ...ctx, clientIp: audit?.clientIp, supersedeLiveRun: false, userAgent: audit?.userAgent },
      {
        ...request,
        agentSender,
        appContext: { ...request.appContext, threadId: scope.threadId, topicId: scope.topicId },
        // A drained follow-up starts its own turn — it did not steer the run
        // it waited behind, so the user message stays unmarked.
        queuedSuccessor: true,
      },
    );
    log(
      '[%s] Started queued follow-up as %s (%d merged)',
      params.operationId,
      result.operationId,
      entries.length,
    );
    await ackFollowUps(scope, drained);
    return { operationId: result.operationId };
  } catch (error) {
    await returnFollowUps(scope, drained, entries, error);
    return;
  }
};
