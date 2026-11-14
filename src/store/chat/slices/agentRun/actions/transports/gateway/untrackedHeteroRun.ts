import type { ConversationContext } from '@lobechat/types';
import debug from 'debug';

import { topicService } from '@/services/topic';
import { topicSelectors } from '@/store/chat/selectors';
import type { ChatStore } from '@/store/chat/store';

const log = debug('lobe-store:untracked-hetero-run');

type Get = () => ChatStore;

/**
 * Markers the server did not take a follow-up behind — no live run of ours
 * (`idle`), a full queue, a failed store, or a request that could not be built.
 * The queue's fallback re-enters the send, so without this it would queue
 * behind the same marker again, forever. The next send starts fresh instead.
 */
const releasedMarkers = new Set<string>();

/** Test-only: forget the released markers. */
export const resetReleasedMarkers = () => releasedMarkers.clear();

/**
 * Stop holding sends behind this marker. Takes the operation id the follow-up
 * was handed off behind, not the topic's current marker: another client may
 * have started a newer run meanwhile, and that one was never checked.
 */
export const releaseUntrackedMarker = (operationId: string | undefined, reason: string) => {
  if (!operationId) return;
  log('releasing untracked marker %s (%s)', operationId, reason);
  releasedMarkers.add(operationId);
};

/**
 * The topic marker of a heterogeneous run (Claude Code / Codex on a device)
 * that no local operation follows, unless the server already found it over.
 *
 * The gateway ends the local operation of such a run on a transport signal
 * alone (a terminal resume status, a raw `session_complete`, a failed
 * re-auth), while the server keeps the marker because the CLI may still be
 * producing. The composer then looks idle; a send that started a fresh run
 * next to the live one would move the topic to it, so the live CLI's next
 * batch is discarded as stale and the CLI stops its agent — killing whatever
 * background work it was waiting on. A send behind such a marker is queued on
 * the server instead: typed into the live session (steer), or handed back
 * when the server finds the run over.
 */
export const findUntrackedHeteroMarker = (get: Get, context: ConversationContext) => {
  if (!context.topicId || context.threadId) return;

  const marker = topicSelectors.getTopicById(context.topicId)(get())?.metadata?.runningOperation;
  if (!marker?.heteroType || releasedMarkers.has(marker.operationId)) return;

  // A run this tab follows is judged by the composer's own predicate.
  const tracked = Object.values(get().operations).some(
    (operation) =>
      operation.type === 'execServerAgentRuntime' &&
      operation.status === 'running' &&
      operation.metadata.serverOperationId === marker.operationId,
  );
  return tracked ? undefined : marker;
};

/**
 * Follow the stream of the untracked hetero run a follow-up was just queued
 * behind, so the steered turn renders live. Only once the server holds the
 * follow-up: the local operation the reconnect starts would otherwise block
 * the client's own send of a follow-up the server handed back.
 */
export const reattachUntrackedHeteroRun = (get: Get, context: ConversationContext) => {
  const marker = findUntrackedHeteroMarker(get, context);
  if (!marker || !context.topicId) return;

  log('re-attaching to untracked hetero run %s on topic %s', marker.operationId, context.topicId);
  get()
    .reconnectToGatewayOperation({
      agentId: context.agentId,
      assistantMessageId: marker.assistantMessageId,
      heteroType: marker.heteroType,
      operationId: marker.operationId,
      scope: marker.scope,
      startedAt: marker.startedAt,
      threadId: marker.threadId,
      topicId: context.topicId,
    })
    .catch((error: unknown) => {
      console.error('[untrackedHeteroRun] re-attaching to the live run failed:', error);
    });
};

/**
 * Re-read the topic when only an untracked hetero marker keeps follow-ups on
 * the server: this tab has no stream left to learn the run ended (a failed or
 * killed CLI never starts them), so the local marker must follow the server's,
 * or the queue would be held — and polled — for as long as the page is open.
 */
export const refreshUntrackedHeteroMarker = async (get: Get, topicId: string) => {
  const localMarkerId = (s: ChatStore) =>
    topicSelectors.getTopicById(topicId)(s)?.metadata?.runningOperation?.operationId;
  const before = localMarkerId(get());
  const topic = await topicService.getTopicDetail(topicId).catch(() => undefined);
  const current = topicSelectors.getTopicById(topicId)(get());
  if (!topic || !current) return;

  // A newer marker landed while the read was in flight: the response predates
  // it and must not overwrite it.
  const localId = current.metadata?.runningOperation?.operationId;
  if (localId !== before) return;

  const runningOperation = topic.metadata?.runningOperation ?? null;
  if (runningOperation?.operationId === localId) return;

  log('marker %s on topic %s is gone on the server', localId, topicId);
  get().internal_dispatchTopic({
    id: topicId,
    type: 'updateTopic',
    value: { metadata: { ...current.metadata, runningOperation } },
  });
};
