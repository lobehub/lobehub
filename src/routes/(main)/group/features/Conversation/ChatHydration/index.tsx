'use client';

import { GROUP_CHAT_TOPIC_URL, GROUP_CHAT_URL } from '@lobechat/const';
import { memo, useLayoutEffect, useRef } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router';

import { useClearActiveTopicUnread } from '@/features/Conversation/hooks';
import { useTopicCommentDeepLink } from '@/features/TopicComment/useTopicCommentDeepLink';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useQueryState } from '@/hooks/useQueryParam';
import { useChatStore } from '@/store/chat';

const getSearchSuffix = (searchParams: URLSearchParams) => {
  const search = searchParams.toString();

  return search ? `?${search}` : '';
};

// sync outside state to useChatStore
const ChatHydration = memo(() => {
  const location = useLocation();
  const navigate = useWorkspaceAwareNavigate();
  const params = useParams<{ gid?: string; topicId?: string }>();
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
        const { gid, topicId } = paramsRef.current;

        if (!gid) return;

        // If the store matches the URL topic, it's already in sync — nothing to do.
        // This also prevents feedback loops between the route-sync layout effect
        // and this subscriber.
        if (state === topicId) return;

        // Guard against the GroupIdSync switchTopic(null) race: when the store's
        // activeTopicId is cleared during the same render cycle that the URL still
        // carries /group/<gid>/<topicId>, restore the store from the URL instead of
        // navigating back to the group root (which caused the "bounce" in #18243).
        // Mirrors the agent-side useChatRouteSync / ActiveConversationBridge
        // restoreTopicAfterScopedReset pattern. Intentional clears (e.g. topic
        // deletion, where the URL topic is also gone) still navigate normally.
        if (state === undefined && topicId) {
          useChatStore.setState(
            { activeTopicId: topicId },
            false,
            'ChatHydration/restoreTopicAfterScopedReset',
          );
          return;
        }

        const nextSearchParams = new URLSearchParams(searchParamsRef.current);
        nextSearchParams.delete('topic');

        const nextPath = state ? GROUP_CHAT_TOPIC_URL(gid, state) : GROUP_CHAT_URL(gid);
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