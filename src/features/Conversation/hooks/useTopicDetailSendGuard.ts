import { useMemo, useRef } from 'react';

import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import { type ConversationHooks } from '../types';

/**
 * Make sure the chat store holds the topic row before a run starts in it.
 *
 * A run reads the topic's saved configuration from the store: its pinned
 * model, working directory and device. A topic opened before any list or
 * detail read reached the store (a first visit to a project topic, a deep link
 * past the loaded pages) would otherwise run on the agent's defaults. On a miss
 * this reads the detail first. A failed read lets the run through as before.
 */
export const ensureTopicBeforeRun = async (topicId: string | null | undefined): Promise<void> => {
  if (!topicId) return;

  const state = useChatStore.getState();
  if (topicSelectors.getTopicById(topicId)(state)) return;

  try {
    await state.refreshTopicDetail(topicId, true);
  } catch (error) {
    console.error('[ensureTopicBeforeRun] Failed to fetch topic detail:', error);
  }
};

/** Conversation hooks that hold a send, regenerate or continue on `ensureTopicBeforeRun`. */
export const useTopicDetailSendGuard = (topicId: string | null | undefined): ConversationHooks => {
  const topicIdRef = useRef(topicId);
  topicIdRef.current = topicId;

  return useMemo(() => {
    const guard = async (): Promise<void> => {
      await ensureTopicBeforeRun(topicIdRef.current);
    };

    return {
      onBeforeContinue: guard,
      onBeforeRegenerate: guard,
      onBeforeSendMessage: guard,
    };
  }, []);
};
