import type { FocusEvent, PointerEvent } from 'react';
import { useEffect, useMemo } from 'react';

import { hasReadingPositionSnapshot } from '@/features/Conversation/ChatList/utils/scrollSnapshotStore';
import { isProjectedConversationRead } from '@/helpers/conversationMessageRead';
import { fetchTopicPreviews, hasRecentTopicPreviewAttempt } from '@/services/message/topicPreview';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { getServerConfigStoreState } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';

import {
  canPrefetchTopicFirstPage,
  canPreviewTopic,
  type TopicHoverEnv,
  type TopicHoverRow,
} from './filters';
import { createTopicHoverScheduler, type TopicHoverScheduler } from './scheduler';

const NEIGHBOR_RADIUS = 2;
const ROW_SELECTOR = '[data-testid="topic-item"][data-topic-id]';

const rows = new Map<string, TopicHoverRow>();
const rowElements = new Map<string, HTMLElement>();

const rowKey = (row: TopicHoverRow) =>
  messageMapKey({ agentId: row.agentId, topicId: row.topicId });

const readEnv = (): TopicHoverEnv => {
  const chat = useChatStore.getState();
  const serverConfig = getServerConfigStoreState();
  return {
    activeTopicId: chat.activeTopicId,
    creatingTopicIds: chat.creatingTopicIds,
    enabled: !!serverConfig && serverConfigSelectors.enableTopicPreview(serverConfig),
    hasLocalMessages: (row) => !!chat.dbMessagesMap[rowKey(row)],
    hasPreview: hasRecentTopicPreviewAttempt,
    hasReadingPosition: (row) => hasReadingPositionSnapshot(rowKey(row)),
    isProjectedRead: isProjectedConversationRead,
    isRunning: (row) =>
      operationSelectors.isAgentRuntimeRunningByContext({
        agentId: row.agentId,
        topicId: row.topicId,
      })(chat),
  };
};

// Sidebar order is whatever the current grouping rendered, so read it from the DOM.
const getNeighbors = (topicId: string) => {
  const element = rowElements.get(topicId);
  if (!element?.isConnected) return [];
  const ordered = [...element.ownerDocument.querySelectorAll<HTMLElement>(ROW_SELECTOR)];
  const index = ordered.indexOf(element);
  if (index < 0) return [];
  const agentId = rows.get(topicId)?.agentId;
  return ordered
    .slice(Math.max(0, index - NEIGHBOR_RADIUS), index + NEIGHBOR_RADIUS + 1)
    .map((row) => row.dataset.topicId!)
    .filter((id) => id !== topicId && rows.get(id)?.agentId === agentId);
};

const fetchPreviewBatch = async (topicIds: string[]) => {
  const byAgent = new Map<string, string[]>();
  for (const topicId of topicIds) {
    const agentId = rows.get(topicId)?.agentId;
    if (!agentId) continue;
    byAgent.set(agentId, [...(byAgent.get(agentId) ?? []), topicId]);
  }
  for (const [agentId, ids] of byAgent) {
    await fetchTopicPreviews({ agentId, topicIds: ids });
  }
};

let scheduler: TopicHoverScheduler | undefined;

const getScheduler = () => {
  if (scheduler) return scheduler;
  const created = createTopicHoverScheduler({
    canPrefetch: (topicId) => {
      const row = rows.get(topicId);
      return !!row && canPrefetchTopicFirstPage(row, readEnv());
    },
    canPreview: (topicId) => {
      const row = rows.get(topicId);
      return !!row && canPreviewTopic(row, readEnv());
    },
    fetchPreviews: fetchPreviewBatch,
    getNeighbors,
    prefetchFirstPage: async (topicId) => {
      const row = rows.get(topicId);
      if (!row) return;
      await useChatStore
        .getState()
        .prefetchMessages({ agentId: row.agentId, scope: 'main', topicId });
    },
  });
  document.addEventListener(
    'scroll',
    (event) => {
      if (event.target instanceof Element && event.target.querySelector(ROW_SELECTOR)) {
        created.scroll();
      }
    },
    { capture: true, passive: true },
  );
  scheduler = created;
  return created;
};

export const useTopicHoverPrefetch = (row: Partial<TopicHoverRow>) => {
  const { agentId, groupId, status, topicId } = row;

  useEffect(() => {
    if (!agentId || !topicId) return;
    const entry = { agentId, groupId, status, topicId };
    rows.set(topicId, entry);
    return () => {
      if (rows.get(topicId) !== entry) return;
      rows.delete(topicId);
      rowElements.delete(topicId);
    };
  }, [agentId, groupId, status, topicId]);

  return useMemo(() => {
    if (!agentId || !topicId) return undefined;
    const track = (element: HTMLElement) => rowElements.set(topicId, element);
    return {
      onFocus: (event: FocusEvent<HTMLElement>) => {
        if (!(event.target instanceof HTMLElement) || !event.target.matches(':focus-visible'))
          return;
        track(event.currentTarget);
        getScheduler().focus(topicId);
      },
      onPointerLeave: () => getScheduler().pointerLeave(topicId),
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        if (event.pointerType !== 'mouse') return;
        track(event.currentTarget);
        getScheduler().pointerMove(topicId);
      },
    };
  }, [agentId, topicId]);
};
