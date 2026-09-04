import { AGENT_CHAT_TOPIC_URL, AGENT_CHAT_URL } from '@lobechat/const';
import { useLayoutEffect, useRef } from 'react';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useQueryState } from '@/hooks/useQueryParam';
import { useParams, useSearchParams } from '@/libs/router/navigation';
import { useChatStore } from '@/store/chat';
import { routerSelectors, useRouterStore } from '@/store/router';

const getSearchSuffix = (searchParams: URLSearchParams) => {
  const search = searchParams.toString();

  return search ? `?${search}` : '';
};

interface ChatRouteSyncOptions {
  getConversationPath?: (agentId: string) => string;
  getTopicPath?: (agentId: string, topicId: string) => string;
}

export const useChatRouteSync = (options: ChatRouteSyncOptions = {}) => {
  const hash = useRouterStore(routerSelectors.hash);
  const currentUrl = useRouterStore(routerSelectors.fullUrl);
  const navigate = useWorkspaceAwareNavigate();
  const params = useParams<{ aid?: string; topicId?: string }>('aid', 'topicId');
  const [searchParams] = useSearchParams();
  const [thread, setThread] = useQueryState('thread', { history: 'replace', throttleMs: 500 });
  const routeTopicId = params.topicId;

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
      (state) => state.activeTopicId,
      (state) => {
        const { aid, topicId } = paramsRef.current;
        const routeAgentId = aid || useChatStore.getState().activeAgentId;

        if (!routeAgentId || state === topicId) return;

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

        const nextPath = state
          ? options.getTopicPath?.(routeAgentId, state) || AGENT_CHAT_TOPIC_URL(routeAgentId, state)
          : options.getConversationPath?.(routeAgentId) || AGENT_CHAT_URL(routeAgentId);
        const nextUrl = `${nextPath}${getSearchSuffix(nextSearchParams)}${hashRef.current}`;

        if (currentUrlRef.current !== nextUrl) navigate(nextUrl, { replace: true });
      },
    );
    const unsubscribeThread = useChatStore.subscribe(
      (state) => state.activeThreadId,
      (state) => {
        setThread(state || null);
      },
    );

    return () => {
      unsubscribeTopic();
      unsubscribeThread();
    };
  }, [navigate, options.getConversationPath, options.getTopicPath, setThread]);
};
