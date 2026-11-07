'use client';

import { useEffect, useMemo } from 'react';

import { useChatStore } from '@/store/chat';
import type { ChatStoreState } from '@/store/chat/initialState';
import { gatewayFeedSelectors, topicSelectors } from '@/store/chat/selectors';
import { INPUT_LOADING_OPERATION_TYPES } from '@/store/chat/slices/operation/types';

/** Non-terminal hub statuses: the run can still stream or wait on the user. */
const LIVE_STATUSES = new Set(['running', 'waiting_input', 'waiting_confirmation']);

const currentOperationId = (topicId: string) =>
  topicSelectors.getTopicById(topicId)(useChatStore.getState())?.metadata?.runningOperation
    ?.operationId;

/**
 * This client runs or streams the topic's main conversation. Thread runs are
 * excluded: they never own the topic's `runningOperation` marker.
 */
const hasLocalMainRun = (topicId: string) =>
  Object.values(useChatStore.getState().operations).some(
    (op) =>
      op.status === 'running' &&
      op.context.topicId === topicId &&
      !op.context.threadId &&
      INPUT_LOADING_OPERATION_TYPES.includes(op.type),
  );

const isHandled = (topicId: string, operationId: string) =>
  hasLocalMainRun(topicId) || currentOperationId(topicId) === operationId;

/**
 * The newest main-line run of `topicId` in the gateway hub feed, encoded as
 * `<operationId>:live` or `<operationId>:ended` so the selection is a stable
 * primitive. Thread and child runs never own the topic's marker.
 */
export const latestTopicOperation =
  (topicId: string) =>
  (s: ChatStoreState): string | undefined => {
    let latest: { at: number; operationId: string; status: string } | undefined;
    for (const [operationId, entry] of Object.entries(gatewayFeedSelectors.gatewayFeed(s))) {
      const { meta } = entry;
      if (meta?.topicId !== topicId || meta.threadId || meta.parentOperationId) continue;
      if (!latest || entry.at > latest.at)
        latest = { at: entry.at, operationId, status: entry.status };
    }
    if (!latest) return;
    return `${latest.operationId}:${LIVE_STATUSES.has(latest.status) ? 'live' : 'ended'}`;
  };

/**
 * The hub announces a run at gateway init, which precedes the server writing
 * the topic's `runningOperation` marker; re-read the detail until it lands.
 */
export const MARKER_RETRY_DELAYS = [0, 500, 1500, 3000];

/**
 * Pick up a run another client started on this topic. Re-reading the topic
 * detail installs its `runningOperation` marker, which `useGatewayReconnect`
 * attaches to with full replay; the message refetch brings the new user turn.
 */
export const syncRemoteTopicRun = async (params: {
  agentId: string;
  operationId: string;
  signal?: AbortSignal;
  topicId: string;
}): Promise<void> => {
  const { agentId, operationId, signal, topicId } = params;
  if (isHandled(topicId, operationId)) return;

  const messages = useChatStore.getState().refreshMessages({ agentId, topicId });
  let lastError: unknown;
  for (const delay of MARKER_RETRY_DELAYS) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    if (signal?.aborted) break;
    try {
      await useChatStore.getState().refreshTopicDetail(topicId, true);
      lastError = undefined;
    } catch (error) {
      // A transient read failure must not end discovery; the next attempt may land.
      lastError = error;
    }
    if (isHandled(topicId, operationId)) break;
  }
  await messages;
  if (lastError) throw lastError;
};

/**
 * Follow runs started on another device while a conversation shows the topic.
 * The per-user gateway socket already broadcasts every operation's lifecycle
 * (`op_lifecycle`, mirrored into `gatewayFeed`) whether or not this client
 * subscribed to it, so a new live operation on this topic is the signal.
 */
export const useTopicRunEvents = (topicId: string | null | undefined, agentId?: string) => {
  const latest = useChatStore((s) => (topicId ? latestTopicOperation(topicId)(s) : undefined));

  // Runs already in the feed when the view opened come with its own fetch;
  // `remote` holds runs this view picked up from another client.
  const seen = useMemo(
    () => ({
      atMount: new Set(Object.keys(useChatStore.getState().gatewayFeed)),
      live: new Set<string>(),
      remote: new Set<string>(),
    }),
    [topicId],
  );

  useEffect(() => {
    if (!topicId || !agentId || !latest) return;

    const separator = latest.lastIndexOf(':');
    const operationId = latest.slice(0, separator);
    const onError = (error: unknown) => {
      console.error('[TopicRunEvents] Failed to sync remote run:', error);
    };

    if (latest.slice(separator + 1) === 'live') {
      seen.live.add(operationId);
      if (isHandled(topicId, operationId)) return;

      seen.remote.add(operationId);
      const ac = new AbortController();
      syncRemoteTopicRun({ agentId, operationId, signal: ac.signal, topicId }).catch(onError);
      return () => ac.abort();
    }

    // A remote run can end before its marker was ever readable (a fast reply,
    // a startup failure): nothing attached, so read the settled transcript.
    const missedLive = !seen.live.has(operationId) && !seen.atMount.has(operationId);
    if (!seen.remote.has(operationId) && !missedLive) return;
    seen.remote.delete(operationId);
    if (hasLocalMainRun(topicId)) return;
    useChatStore.getState().refreshMessages({ agentId, topicId }).catch(onError);
  }, [agentId, latest, seen, topicId]);
};
