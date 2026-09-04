'use client';

import { GROUP_CHAT_TOPIC_URL, GROUP_CHAT_URL } from '@lobechat/const';
import { memo, useLayoutEffect, useRef } from 'react';

import { useClearActiveTopicUnread } from '@/features/Conversation/hooks';
import { useTopicCommentDeepLink } from '@/features/TopicComment/useTopicCommentDeepLink';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useQueryState } from '@/hooks/useQueryParam';
import { useParams, useSearchParams } from '@/libs/router/navigation';
import { useChatStore } from '@/store/chat';
import { routerSelectors, useRouterStore } from '@/store/router';

const getSearchSuffix = (searchParams: URLSearchParams) => {
  const search = searchParams.toString();

  return search ? `?${search}` : '';
};

// sync outside state to useChatStore
const ChatHydration = memo(() => {
  const hash = useRouterStore(routerSelectors.hash);
  const currentUrl = useRouterStore(routerSelectors.fullUrl);
  const navigate = useWorkspaceAwareNavigate();
  const params = useParams<{ gid?: string; topicId?: string }>('gid', 'topicId');
  const [searchParams] = useSearchParams();

  const [thread, setThread] = useQueryState('thread', { history: 'replace', throttleMs: 500 });
  const routeTopicId = params.topicId;

  // Route hydration sets activeTopicId directly (below) instead of going through
  // switchTopic, so clear any lingering persisted unread once the topic loads.
  useClearActiveTopicUnread();
  useTopicCommentDeepLink(routeTopicId);

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

  const hashRef = useRef(hash);
  const currentUrlRef = useRef(currentUrl);
  const paramsRef = useRef(params);
  const searchParamsRef = useRef(searchParams);

  hashRef.current = hash;
  currentUrlRef.current = currentUrl;
  paramsRef.current = params;
  searchParamsRef.current = searchParams;

  useLayoutEffect(() => {
    const unsubscribeTopic = useChatStore.subscribe(
      (s) => s.activeTopicId,
      (state) => {
        const { gid } = paramsRef.current;

        if (!gid) return;

        const nextSearchParams = new URLSearchParams(searchParamsRef.current);
        nextSearchParams.delete('topic');

        const nextPath = state ? GROUP_CHAT_TOPIC_URL(gid, state) : GROUP_CHAT_URL(gid);
        const nextUrl = `${nextPath}${getSearchSuffix(nextSearchParams)}${hashRef.current}`;

        if (currentUrlRef.current !== nextUrl) {
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
