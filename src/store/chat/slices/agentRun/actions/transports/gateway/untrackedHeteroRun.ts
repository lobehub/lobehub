import type { ConversationContext } from '@lobechat/types';
import debug from 'debug';

import { topicService } from '@/services/topic';
import { topicSelectors } from '@/store/chat/selectors';
import type { ChatStore } from '@/store/chat/store';

const log = debug('lobe-store:untracked-hetero-run');

type Get = () => ChatStore;

/**
 * Markers the server answered `idle` for: the follow-up queue found no live
 * run of ours behind them, so the next send must start fresh instead of
 * queueing behind them again (the queue's `idle` fallback re-enters the send).
 */
const serverIdleMarkers = new Set<string>();

/** Test-only: forget the markers the server answered `idle` for. */
export const resetServerIdleMarkers = () => serverIdleMarkers.clear();

/** Record that the server found no live run behind this topic's current marker. */
export const noteServerIdleMarker = (get: Get, topicId: string | null | undefined) => {
  if (!topicId) return;
  const marker = topicSelectors.getTopicById(topicId)(get())?.metadata?.runningOperation;
  if (!marker?.operationId) return;
  log('server found no live run behind marker %s on topic %s', marker.operationId, topicId);
  serverIdleMarkers.add(marker.operationId);
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
  if (!marker?.heteroType || serverIdleMarkers.has(marker.operationId)) return;

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
  const topic = await topicService.getTopicDetail(topicId).catch(() => undefined);
  const current = topicSelectors.getTopicById(topicId)(get());
  if (!topic || !current) return;

  const runningOperation = topic.metadata?.runningOperation ?? null;
  const localId = current.metadata?.runningOperation?.operationId;
  if (runningOperation?.operationId === localId) return;

  log('marker %s on topic %s is gone on the server', localId, topicId);
  get().internal_dispatchTopic({
    id: topicId,
    type: 'updateTopic',
    value: { metadata: { ...current.metadata, runningOperation } },
  });
};
