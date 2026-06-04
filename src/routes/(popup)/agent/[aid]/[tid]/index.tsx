'use client';

import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';

import { useFetchTopics } from '@/hooks/useFetchTopics';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';
import Conversation from '@/routes/(main)/agent/features/Conversation';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

const PopupAgentTopicPage = memo(() => {
  const { aid, tid } = useParams<{ aid: string; tid: string }>();

  useInitAgentConfig(aid);

  const activeAgentId = useChatStore((s) => s.activeAgentId);
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const syncedTopicIdRef = useRef<string | undefined>(undefined);
  const syncingTopicIdRef = useRef<string | undefined>(undefined);
  const syncSessionId = useChatStore((s) =>
    tid ? topicSelectors.getTopicById(tid)(s)?.metadata?.heteroSessionId : undefined,
  );
  const syncWorkingDirectory = useChatStore((s) =>
    tid ? topicSelectors.getTopicById(tid)(s)?.metadata?.workingDirectory : undefined,
  );
  const syncProviderType = useAgentStore((s) =>
    activeAgentId
      ? s.agentMap[activeAgentId]?.agencyConfig?.heterogeneousProvider?.type
      : undefined,
  );

  useLayoutEffect(() => {
    if (!aid) return;
    useAgentStore.setState({ activeAgentId: aid }, false, 'PopupAgentTopicPage/sync');
    useChatStore.setState(
      {
        activeAgentId: aid,
        activeGroupId: undefined,
        activeThreadId: undefined,
        activeTopicId: tid,
      },
      false,
      'PopupAgentTopicPage/sync',
    );
  }, [aid, tid]);

  useEffect(() => {
    if (!tid) {
      syncedTopicIdRef.current = undefined;
      syncingTopicIdRef.current = undefined;
      return;
    }
    if (syncedTopicIdRef.current && syncedTopicIdRef.current !== tid) {
      syncedTopicIdRef.current = undefined;
    }
    if (syncingTopicIdRef.current && syncingTopicIdRef.current !== tid) {
      syncingTopicIdRef.current = undefined;
    }
    if (
      !syncSessionId ||
      activeAgentId !== aid ||
      activeTopicId !== tid ||
      syncProviderType !== 'claude-code' ||
      syncedTopicIdRef.current === tid ||
      syncingTopicIdRef.current === tid
    )
      return;

    syncingTopicIdRef.current = tid;
    useChatStore
      .getState()
      .syncClaudeCodeHistory(tid)
      .then((result) => {
        if (result !== 'skipped') syncedTopicIdRef.current = tid;
      })
      .catch((error) => {
        console.error('[ClaudeCodeHistorySync] Failed:', error);
      })
      .finally(() => {
        if (syncingTopicIdRef.current === tid) syncingTopicIdRef.current = undefined;
      });
  }, [
    activeAgentId,
    activeTopicId,
    aid,
    syncProviderType,
    syncSessionId,
    syncWorkingDirectory,
    tid,
  ]);

  // Populate topicDataMap so the title-bar can resolve the topic title,
  // and so chat operations that read topic metadata behave correctly.
  useFetchTopics();

  if (!aid || !tid) return null;

  return <Conversation />;
});

PopupAgentTopicPage.displayName = 'PopupAgentTopicPage';

export default PopupAgentTopicPage;
