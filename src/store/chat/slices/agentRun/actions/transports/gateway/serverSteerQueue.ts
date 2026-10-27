import type { ConversationContext } from '@lobechat/types';
import debug from 'debug';

import { aiAgentService, type QueuedFollowUpRequest } from '@/services/aiAgent';
import { topicService } from '@/services/topic';
import { topicSelectors } from '@/store/chat/selectors';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import {
  isClientHeldQueuedMessage,
  type QueuedFile,
  type QueuedMessage,
} from '@/store/chat/slices/operation/types';
import type { ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { isTrpcErrorCode } from '@/utils/trpcError';

import { scheduleQueuedFollowUp } from '../../lifecycle/queuedFollowUp';

const log = debug('lobe-store:server-steer-queue');

/** How often a conversation with follow-ups on the server checks which are still waiting. */
export const SERVER_QUEUE_POLL_MS = 1500;
/** Longest wait between checks while the queue cannot be read. */
const MAX_POLL_BACKOFF_MS = 30_000;
/** A hidden tab checks this rarely; nothing on screen needs the tray then. */
const HIDDEN_POLL_MS = 15_000;
/** Reads of the queue when a conversation opens, should the first ones fail. */
const RESTORE_ATTEMPTS = 5;

/** Delay before the next check: backs off after failed reads, and while hidden. */
const nextPollDelay = (failures: number) => {
  const delay = Math.min(SERVER_QUEUE_POLL_MS * 2 ** failures, MAX_POLL_BACKOFF_MS);
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  return hidden ? Math.max(delay, HIDDEN_POLL_MS) : delay;
};
/** Reads of the topic after the server took the follow-ups, until its next run shows up. */
const SUCCESSOR_SYNC_ATTEMPTS = 5;
/** How long to wait for the run that took the follow-ups to end here. */
const LOCAL_RUN_SETTLE_TIMEOUT_MS = 30 * 60 * 1000;
/**
 * Checks with no run here and the follow-ups still waiting on the server. The
 * run that ended took nothing (it failed or was stopped), so they come back.
 */
const ORPHANED_QUEUE_TICKS = 20;
/**
 * How long an unconfirmed append may be settled by retrying its id. The server
 * remembers delivered ids for a day after their drain; past that a retry could
 * no longer tell "delivered" from "never stored", so it must not be sent here.
 */
const UNCONFIRMED_SETTLE_MS = 23 * 60 * 60 * 1000;
/** An append whose outcome is unknown is retried with the same id. */
const APPEND_ATTEMPTS = 3;

type Get = () => ChatStore;

/** In-flight hand-offs, chained per conversation so the server keeps the queue order. */
const handOffChains = new Map<string, Promise<void>>();
/** In-flight hand-off of each message, so a withdrawal waits for its outcome. */
const handOffs = new Map<string, Promise<void>>();
/** In-flight reclaims per conversation: two removes of one id would drop it. */
const reclaims = new Map<string, Promise<void>>();
/** Conversations whose follow-ups on the server are being watched. */
const watchers = new Set<string>();

const queueOf = (get: Get, contextKey: string): QueuedMessage[] =>
  get().queuedMessages?.[contextKey] ?? [];

const findQueued = (get: Get, contextKey: string, id: string) =>
  queueOf(get, contextKey).find((message) => message.id === id);

const surfaceOf = (request: QueuedFollowUpRequest) => ({
  threadId: request.appContext?.threadId ?? null,
  topicId: request.appContext!.topicId!,
});

const hasLocalRun = (get: Get, context: ConversationContext) =>
  operationSelectors.getRunningQueueBlockingOperationIds(context)(get()).length > 0;

/**
 * Whether the server queue — one per user, topic and thread — is this
 * conversation's alone: an agent's own main conversation on an existing
 * topic. Group, group-member, page-document, builder, thread and shared
 * conversations split one topic into several message buckets the server
 * cannot tell apart, so they keep the client queue.
 */
const ownsTopicQueue = (context: ConversationContext): boolean =>
  !!context.topicId &&
  !context.threadId &&
  !context.groupId &&
  !context.agentShareId &&
  !context.topicShareId &&
  (!context.scope || context.scope === 'main');

/**
 * Whether a send queued behind this conversation's run can be queued on the
 * server: a Gateway run on a conversation that owns its topic's server queue
 * (see {@link ownsTopicQueue}), with nothing queued ahead that only this
 * client holds (it would be overtaken).
 */
export const canQueueOnServer = (
  get: Get,
  contextKey: string,
  params: { context: ConversationContext; isGatewayRun: boolean },
): boolean => {
  const { context, isGatewayRun } = params;
  if (!isGatewayRun || !ownsTopicQueue(context)) return false;

  return !queueOf(get, contextKey).some(isClientHeldQueuedMessage);
};

/** The conversation key holding a follow-up the server still has (one a run may be delivering). */
export const findServerHeldQueueKey = (get: Get, keys: string[]): string | undefined =>
  keys.find((key) => queueOf(get, key).some((message) => !isClientHeldQueuedMessage(message)));

/** The follow-ups only this client holds are sent by it once nothing runs. */
const sendIfIdle = (get: Get, contextKey: string, context: ConversationContext) => {
  const queue = queueOf(get, contextKey);
  if (queue.length === 0 || !queue.every(isClientHeldQueuedMessage)) return;
  if (hasLocalRun(get, context)) return;

  const operationIds = get().operationsByContext[contextKey] ?? [];
  scheduleQueuedFollowUp(get, context, operationIds.at(-1) ?? '');
};

/** The server refused before storing anything; any other failure leaves it unknown. */
const DEFINITE_REJECTIONS = ['BAD_REQUEST', 'FORBIDDEN', 'NOT_FOUND', 'UNAUTHORIZED'] as const;
const isDefiniteRejection = (error: unknown) =>
  DEFINITE_REJECTIONS.some((code) => isTrpcErrorCode(error, code));

const appendWithRetry = async (
  id: string,
  request: QueuedFollowUpRequest,
  message?: QueuedMessage,
) => {
  let lastError: unknown;
  for (let attempt = 0; attempt < APPEND_ATTEMPTS; attempt++) {
    try {
      return await aiAgentService.appendQueuedFollowUp({
        composer: message && {
          editorData: message.editorData,
          filesPreview: message.filesPreview as Record<string, any>[] | undefined,
        },
        id,
        request,
      });
    } catch (error) {
      lastError = error;
      if (!isTrpcErrorCode(error, 'SERVICE_UNAVAILABLE')) break;
    }
  }
  throw lastError;
};

/**
 * Hand a queued message to the server queue behind the running Gateway run.
 * Kept by the server, it joins that run before its next model call or starts
 * as the next turn, also with this tab closed. Anything else keeps it here,
 * where it is sent once the run ends, as before.
 */
export const handOffQueuedMessage = (
  get: Get,
  contextKey: string,
  context: ConversationContext,
  id: string,
  buildRequest?: () => Promise<QueuedFollowUpRequest>,
): Promise<void> => {
  const run = async () => {
    const keepHere = () => {
      get().updateQueuedMessage(contextKey, id, { serverDelivery: undefined });
      get().internal_syncQueuedMessagesFlag(contextKey);
      sendIfIdle(get, contextKey, context);
    };

    const queue = queueOf(get, contextKey);
    const index = queue.findIndex((message) => message.id === id);
    if (index < 0) return;
    // Something ahead of it stayed here: the server would deliver this one first.
    if (queue.slice(0, index).some(isClientHeldQueuedMessage)) return keepHere();

    let request = queue[index].serverRequest;
    if (!request && buildRequest) {
      try {
        request = await buildRequest();
        get().updateQueuedMessage(contextKey, id, { serverRequest: request });
      } catch (error) {
        console.error('[serverSteerQueue] building the queued request failed:', error);
      }
    }
    if (!request) return keepHere();

    get().updateQueuedMessage(contextKey, id, { serverDelivery: 'appending' });
    let queued = false;
    let unconfirmed = false;
    try {
      queued = (await appendWithRetry(id, request, findQueued(get, contextKey, id))).queued;
    } catch (error) {
      console.error('[serverSteerQueue] queueing on the server failed:', error);
      // Unless refused outright it may have been stored, and sending it from
      // here too could run it twice. It stays the server's until a retry of
      // the same id says where it is.
      unconfirmed = !isDefiniteRejection(error);
    }

    if (!findQueued(get, contextKey, id)) {
      // Withdrawn while the append was in flight.
      if (queued || unconfirmed)
        await aiAgentService.removeQueuedFollowUp({ ...surfaceOf(request), id }).catch(() => {});
      return;
    }
    if (!queued && !unconfirmed) return keepHere();

    log('[%s] %s queued on the server%s', contextKey, id, unconfirmed ? ' (unconfirmed)' : '');
    get().updateQueuedMessage(contextKey, id, {
      serverDelivery: 'server',
      serverUnconfirmed: unconfirmed || undefined,
    });
    watchServerQueue(get, contextKey, context);
  };

  const previous = handOffChains.get(contextKey) ?? Promise.resolve();
  const handOff = previous.then(run, run);
  const settled = handOff.finally(() => {
    handOffs.delete(id);
    if (handOffChains.get(contextKey) === settled) handOffChains.delete(contextKey);
  });
  handOffChains.set(contextKey, settled);
  handOffs.set(id, settled);

  return settled;
};

/**
 * After the server took its follow-ups with no run of ours left locally, it
 * started them as the next run: publish that run's marker so the conversation
 * reconnects to it.
 */
const syncQueuedSuccessorRun = async (get: Get, context: ConversationContext) => {
  const { topicId } = context;
  if (!topicId) return;
  const knownOperationId =
    topicSelectors.getTopicById(topicId)(get())?.metadata?.runningOperation?.operationId;

  for (let attempt = 0; attempt < SUCCESSOR_SYNC_ATTEMPTS; attempt++) {
    if (hasLocalRun(get, context)) return;

    const topic = await topicService.getTopicDetail(topicId).catch(() => undefined);
    const runningOperation = topic?.metadata?.runningOperation;
    if (runningOperation && runningOperation.operationId !== knownOperationId) {
      const current = topicSelectors.getTopicById(topicId)(get());
      if (!current) return;
      get().internal_dispatchTopic({
        id: topicId,
        type: 'updateTopic',
        value: { metadata: { ...current.metadata, runningOperation } },
      });
      if (get().activeTopicId === topicId) await get().refreshMessages();
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, SERVER_QUEUE_POLL_MS));
  }
};

const onServerQueueDelivered = async (
  get: Get,
  contextKey: string,
  context: ConversationContext,
) => {
  // Joined into the run, or taken by it as it ended — its end may not have
  // reached this client yet. Either way, the next run (if any) is known once
  // this one settles.
  const settleBy = Date.now() + LOCAL_RUN_SETTLE_TIMEOUT_MS;
  while (hasLocalRun(get, context) && Date.now() < settleBy)
    await new Promise((resolve) => setTimeout(resolve, SERVER_QUEUE_POLL_MS));
  if (!hasLocalRun(get, context)) await syncQueuedSuccessorRun(get, context);

  // Queued here behind the delivered ones: the server can take them now.
  const left = queueOf(get, contextKey).filter(
    (message) => isClientHeldQueuedMessage(message) && message.serverRequest,
  );
  if (left.length === 0) return sendIfIdle(get, contextKey, context);
  for (const message of left) void handOffQueuedMessage(get, contextKey, context, message.id);
};

/**
 * An append whose answer was lost and that the server does not list: append
 * the same id again, which never stores it twice, and let the answer say where
 * it is — waiting, delivered, or never stored (then this client sends it).
 */
const reconcileUnconfirmed = async (
  get: Get,
  contextKey: string,
  context: ConversationContext,
  message: QueuedMessage,
): Promise<'delivered' | 'held' | 'kept'> => {
  // Too old to settle safely: drop it rather than risk running it twice.
  if (Date.now() - message.createdAt > UNCONFIRMED_SETTLE_MS) {
    console.warn('[serverSteerQueue] dropping %s: unconfirmed for too long to settle', message.id);
    get().removeQueuedMessage(contextKey, message.id);
    return 'delivered';
  }
  try {
    const result = await appendWithRetry(message.id, message.serverRequest!, message);
    // Delivered already: the caller completes it like any delivered one.
    if (result.queued && result.state === 'taken') return 'delivered';
    if (result.queued) {
      // Waiting, or on its way into a run: the server's, now confirmed.
      get().updateQueuedMessage(contextKey, message.id, { serverUnconfirmed: undefined });
      return 'held';
    }
  } catch (error) {
    if (!isDefiniteRejection(error)) return 'held';
  }
  // Not on the server and refused now: only this client holds it.
  get().updateQueuedMessage(contextKey, message.id, {
    serverDelivery: undefined,
    serverUnconfirmed: undefined,
  });
  get().internal_syncQueuedMessagesFlag(contextKey);
  sendIfIdle(get, contextKey, context);
  return 'kept';
};

/**
 * Follow the conversation's follow-ups on the server until all of them left
 * its queue — joined into the run or started as the next turn — and drop
 * each from the tray as it goes.
 */
export const watchServerQueue = (get: Get, contextKey: string, context: ConversationContext) => {
  if (watchers.has(contextKey)) return;
  watchers.add(contextKey);
  let ticksWithoutRun = 0;
  let failures = 0;

  const tick = async () => {
    const held = queueOf(get, contextKey).filter(
      (message) => message.serverDelivery === 'server' && message.serverRequest,
    );
    if (held.length === 0) {
      watchers.delete(contextKey);
      return;
    }

    try {
      // Taken by a run but not confirmed (`delivering`) still counts as held:
      // a failed delivery returns it to the queue.
      const notDelivered = new Set(
        (await aiAgentService.listQueuedFollowUps(surfaceOf(held[0].serverRequest!))).map(
          (entry) => entry.id,
        ),
      );
      const settledDelivered = new Set<string>();
      for (const message of held) {
        if (!message.serverUnconfirmed) continue;
        if (notDelivered.has(message.id))
          get().updateQueuedMessage(contextKey, message.id, { serverUnconfirmed: undefined });
        else if ((await reconcileUnconfirmed(get, contextKey, context, message)) === 'delivered')
          settledDelivered.add(message.id);
      }
      // Confirmed ones gone from the server, and unconfirmed ones it says it delivered.
      const delivered = held.filter((message) =>
        message.serverUnconfirmed
          ? settledDelivered.has(message.id)
          : !notDelivered.has(message.id),
      );
      for (const message of delivered) {
        if (findQueued(get, contextKey, message.id)?.serverDelivery === 'server')
          get().removeQueuedMessage(contextKey, message.id);
      }
      const stillHeld = queueOf(get, contextKey).some(
        (message) => message.serverDelivery === 'server',
      );
      if (delivered.length > 0 && !stillHeld) {
        watchers.delete(contextKey);
        await onServerQueueDelivered(get, contextKey, context);
        return;
      }
      failures = 0;
    } catch (error) {
      // Unknown, not delivered: keep them, and back off an already failing path.
      failures += 1;
      console.error('[serverSteerQueue] reading the server queue failed:', error);
    }

    ticksWithoutRun = hasLocalRun(get, context) ? 0 : ticksWithoutRun + 1;
    // Stopped elsewhere: that run starts nothing next, take them back now.
    const stopped =
      operationSelectors.getIdleQueueHost(context)(get())?.metadata.endedWithoutCompletion;
    if (stopped || ticksWithoutRun >= ORPHANED_QUEUE_TICKS) {
      await reclaimServerQueuedMessages(get, contextKey);
      // One still on its way stays the server's until it lands or comes back.
      if (!queueOf(get, contextKey).some((message) => message.serverDelivery === 'server')) {
        watchers.delete(contextKey);
        return;
      }
    }

    setTimeout(tick, nextPollDelay(failures));
  };

  setTimeout(tick, nextPollDelay(0));
};

/** Read the queue, retrying with backoff: a failed read is unknown, not empty. */
const listWithRetry = async (surface: { threadId: null; topicId: string }) => {
  for (let attempt = 0; attempt < RESTORE_ATTEMPTS; attempt++) {
    try {
      return await aiAgentService.listQueuedFollowUps(surface);
    } catch (error) {
      console.error('[serverSteerQueue] reading the server queue failed:', error);
      if (attempt < RESTORE_ATTEMPTS - 1)
        await new Promise((resolve) => setTimeout(resolve, nextPollDelay(attempt)));
    }
  }
  return [];
};

/**
 * Put the follow-ups still waiting on the server back in the tray of a
 * conversation this page reconnects to (after a reload, or opened elsewhere),
 * and follow them again, so they show as queued and the run that takes them is
 * picked up here.
 */
export const restoreServerQueuedMessages = async (
  get: Get,
  context: ConversationContext,
): Promise<void> => {
  const { agentId, topicId } = context;
  // Not gated on Gateway mode being on now: entries accepted while it was stay
  // up to a day and must remain visible and withdrawable after it is turned off.
  if (!agentId || !topicId || !ownsTopicQueue(context)) return;

  const surface = { threadId: null, topicId };
  const pending = await listWithRetry(surface);
  if (pending.length === 0) return;

  const contextKey = messageMapKey(context);
  const known = new Set(queueOf(get, contextKey).map((message) => message.id));
  for (const entry of pending) {
    if (known.has(entry.id)) continue;
    get().enqueueMessage(contextKey, {
      content: entry.prompt,
      createdAt: entry.createdAt,
      // The composer state it was sent from, so a local resend keeps its
      // selected skills, tools and mentions.
      ...(entry.editorData && { editorData: entry.editorData }),
      // Previews let the tray show its attachments and Edit put them back.
      ...(entry.filesPreview?.length && {
        filesPreview: entry.filesPreview as unknown as QueuedFile[],
      }),
      ...(entry.fileIds?.length && { files: entry.fileIds }),
      id: entry.id,
      interruptMode: 'soft',
      serverDelivery: 'server',
      serverRequest: {
        agentId,
        appContext: { threadId: null, topicId },
        fileIds: entry.fileIds ?? undefined,
        mentionedAgents: entry.mentionedAgents ?? undefined,
        prompt: entry.prompt,
        selectedSkillIds: entry.selectedSkillIds ?? undefined,
        selectedToolIds: entry.selectedToolIds ?? undefined,
      },
    });
  }
  log('[%s] restored %d follow-ups from the server', contextKey, pending.length);
  watchServerQueue(get, contextKey, context);
};

/**
 * Whether a withdrawal made this caller the only holder of the follow-up.
 * Only `removed` proves that for a confirmed entry: `absent` then means
 * another tab withdrew it first, and both sending it would run it twice. For
 * an unconfirmed append, `absent` means it was never stored.
 */
const ownsWithdrawn = (message: QueuedMessage, state: string) =>
  state === 'removed' || (state === 'absent' && !!message.serverUnconfirmed);

/**
 * Take the follow-ups back from the server queue, so only this client holds
 * them again — for a stopped run, which starts nothing next. The ones the
 * server already took are gone from the tray.
 */
export const reclaimServerQueuedMessages = (get: Get, contextKey: string): Promise<void> => {
  const inFlight = reclaims.get(contextKey);
  if (inFlight) return inFlight;

  const reclaim = (async () => {
    await handOffChains.get(contextKey);

    for (const message of queueOf(get, contextKey)) {
      if (message.serverDelivery !== 'server' || !message.serverRequest) continue;
      try {
        const { state } = await aiAgentService.removeQueuedFollowUp({
          ...surfaceOf(message.serverRequest),
          id: message.id,
        });
        // Removed by this call, or an unconfirmed append never stored: only
        // this client holds it now.
        if (ownsWithdrawn(message, state))
          get().updateQueuedMessage(contextKey, message.id, {
            serverDelivery: undefined,
            serverUnconfirmed: undefined,
          });
        // Delivered, or taken back by another tab. One still `delivering` stays
        // the server's until it lands or comes back.
        else if (state !== 'delivering') get().removeQueuedMessage(contextKey, message.id);
      } catch (error) {
        // Still on the server, which delivers it on the conversation's next run.
        console.error('[serverSteerQueue] taking a follow-up back failed:', error);
      }
    }
  })().finally(() => reclaims.delete(contextKey));
  reclaims.set(contextKey, reclaim);

  return reclaim;
};

/**
 * Withdraw one queued message from the tray, and from the server when it is
 * there. `false` means the server already took it to deliver, so it must not
 * be sent or edited again.
 */
export const withdrawQueuedMessage = async (
  get: Get,
  contextKey: string,
  id: string,
): Promise<boolean> => {
  await handOffs.get(id);
  const message = findQueued(get, contextKey, id);
  if (!message) return false;

  if (message.serverDelivery === 'server' && message.serverRequest) {
    const { state } = await aiAgentService.removeQueuedFollowUp({
      ...surfaceOf(message.serverRequest),
      id,
    });
    // Taken but not settled: it stays shown until it lands or comes back.
    if (state === 'delivering') return false;
    get().removeQueuedMessage(contextKey, id);
    return ownsWithdrawn(message, state);
  }

  get().removeQueuedMessage(contextKey, id);
  return true;
};
