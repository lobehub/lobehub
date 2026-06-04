'use client';

import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { SESSION_CHAT_TOPIC_URL, SESSION_CHAT_URL } from '@/const/url';
import { useQueryState } from '@/hooks/useQueryParam';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

const getSearchSuffix = (searchParams: URLSearchParams) => {
  const search = searchParams.toString();

  return search ? `?${search}` : '';
};

// sync outside state to useChatStore
const ChatHydration = memo(() => {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{ aid?: string; topicId?: string }>();
  const [searchParams] = useSearchParams();

  const [thread, setThread] = useQueryState('thread', { history: 'replace', throttleMs: 500 });
  const routeTopicId = params.topicId;

  const activeAgentId = useChatStore((s) => s.activeAgentId);
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const syncedTopicIdRef = useRef<string | undefined>(undefined);
  const syncingTopicIdRef = useRef<string | undefined>(undefined);
  const syncSessionId = useChatStore((s) =>
    routeTopicId
      ? topicSelectors.getTopicById(routeTopicId)(s)?.metadata?.heteroSessionId
      : undefined,
  );
  const syncWorkingDirectory = useChatStore((s) =>
    routeTopicId
      ? topicSelectors.getTopicById(routeTopicId)(s)?.metadata?.workingDirectory
      : undefined,
  );
  const syncProviderType = useAgentStore((s) =>
    activeAgentId
      ? s.agentMap[activeAgentId]?.agencyConfig?.heterogeneousProvider?.type
      : undefined,
  );

  useLayoutEffect(() => {
    const target = routeTopicId ?? null;
    if (useChatStore.getState().activeTopicId !== target) {
      useChatStore.setState({ activeTopicId: target! }, false, 'ChatHydration/syncTopicFromUrl');
    }
  }, [routeTopicId]);

  useEffect(() => {
    if (!routeTopicId) {
      syncedTopicIdRef.current = undefined;
      syncingTopicIdRef.current = undefined;
      return;
    }
    if (syncedTopicIdRef.current && syncedTopicIdRef.current !== routeTopicId) {
      syncedTopicIdRef.current = undefined;
    }
    if (syncingTopicIdRef.current && syncingTopicIdRef.current !== routeTopicId) {
      syncingTopicIdRef.current = undefined;
    }
    if (
      !syncSessionId ||
      activeAgentId !== params.aid ||
      activeTopicId !== routeTopicId ||
      syncProviderType !== 'claude-code' ||
      syncedTopicIdRef.current === routeTopicId ||
      syncingTopicIdRef.current === routeTopicId
    )
      return;

    syncingTopicIdRef.current = routeTopicId;
    useChatStore
      .getState()
      .syncClaudeCodeHistory(routeTopicId)
      .then((result) => {
        if (result !== 'skipped') syncedTopicIdRef.current = routeTopicId;
      })
      .catch((error) => {
        console.error('[ClaudeCodeHistorySync] Failed:', error);
      })
      .finally(() => {
        if (syncingTopicIdRef.current === routeTopicId) syncingTopicIdRef.current = undefined;
      });
  }, [
    activeAgentId,
    activeTopicId,
    params.aid,
    routeTopicId,
    syncProviderType,
    syncSessionId,
    syncWorkingDirectory,
  ]);

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

        const nextPath = state ? SESSION_CHAT_TOPIC_URL(aid, state) : SESSION_CHAT_URL(aid);
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
