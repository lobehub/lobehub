'use client';

import { AGENT_CHAT_TOPIC_URL, AGENT_CHAT_URL } from '@lobechat/const';
import { memo, useLayoutEffect, useRef } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router';

import { useClearActiveTopicUnread } from '@/features/Conversation/hooks';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useQueryState } from '@/hooks/useQueryParam';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

const getSearchSuffix = (searchParams: URLSearchParams) => {
  const search = searchParams.toString();

  return search ? `?${search}` : '';
};

// sync outside state to useChatStore
const ChatHydration = memo(() => {
  const location = useLocation();
  const navigate = useWorkspaceAwareNavigate();
  const params = useParams<{ aid?: string; topicId?: string }>();
  const [searchParams] = useSearchParams();

  const [thread, setThread] = useQueryState('thread', { history: 'replace', throttleMs: 500 });
  const routeTopicId = params.topicId;
  const activeAgentId = useChatStore((s) => s.activeAgentId);
  const topicMetadata = useChatStore((s) =>
    routeTopicId ? topicSelectors.getTopicById(routeTopicId)(s)?.metadata : undefined,
  );
  const useFetchTopicLinkedPullRequest = useChatStore((s) => s.useFetchTopicLinkedPullRequest);

  // Route hydration sets activeTopicId directly (below) instead of going through
  // switchTopic, so clear any lingering persisted unread once the topic loads.
  useClearActiveTopicUnread();
  useFetchTopicLinkedPullRequest(activeAgentId ? routeTopicId : undefined, topicMetadata);

  useLayoutEffect(() => {
    const target = routeTopicId ?? null;
    if (useChatStore.getState().activeTopicId !== target) {
      useChatStore.setState({ activeTopicId: target! }, false, 'ChatHydration/syncTopicFromUrl');
    }
  }, [routeTopicId]);

  useLayoutEffect(() => {
    const target = thread ?? null;
    if (useChatStore.getState().activeThreadId !== target) {
      useChatStore.setState({ activeThreadId: target! }, false, 'ChatHydration/syncThreadFromUrl');
    }
  }, [thread]);

  const locationRef = useRef(location);
  const paramsRef = useRef(params);
  const searchParamsRef = useRef(searchParams);

  locationRef.current = location;
  paramsRef.current = params;
  searchParamsRef.current = searchParams;

  useLayoutEffect(() => {
    const unsubscribeTopic = useChatStore.subscribe(
      (s) => s.activeTopicId,
      (state) => {
        const { aid } = paramsRef.current;

        if (!aid) return;

        const nextSearchParams = new URLSearchParams(searchParamsRef.current);
        nextSearchParams.delete('topic');

        const nextPath = state ? AGENT_CHAT_TOPIC_URL(aid, state) : AGENT_CHAT_URL(aid);
        const nextUrl = `${nextPath}${getSearchSuffix(nextSearchParams)}${locationRef.current.hash}`;
        const currentUrl = `${locationRef.current.pathname}${locationRef.current.search}${locationRef.current.hash}`;

        if (currentUrl !== nextUrl) {
          navigate(nextUrl, { replace: true });
        }
      },
    );
    const unsubscribeThread = useChatStore.subscribe(
      (s) => s.activeThreadId,
      (state) => {
        setThread(state || null);
      },
    );

    return () => {
      unsubscribeTopic();
      unsubscribeThread();
    };
  }, [navigate, setThread]);

  return null;
});

export default ChatHydration;
