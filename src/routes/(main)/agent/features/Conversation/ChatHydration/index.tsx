'use client';

import { memo, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { createStoreUpdater } from 'zustand-utils';

import { SESSION_CHAT_TOPIC_URL, SESSION_CHAT_URL } from '@/const/url';
import { useQueryState } from '@/hooks/useQueryParam';
import { useChatStore } from '@/store/chat';

const getSearchSuffix = (searchParams: URLSearchParams) => {
  const search = searchParams.toString();

  return search ? `?${search}` : '';
};

// sync outside state to useChatStore
const ChatHydration = memo(() => {
  const useStoreUpdater = createStoreUpdater(useChatStore);
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{ aid?: string; topicId?: string }>();
  const [searchParams] = useSearchParams();

  const [thread, setThread] = useQueryState('thread', { history: 'replace', throttleMs: 500 });
  const routeTopicId = params.topicId ?? searchParams.get('topic');

  useStoreUpdater('activeTopicId', routeTopicId ?? undefined);
  useStoreUpdater('activeThreadId', thread!);

  const locationRef = useRef(location);
  const paramsRef = useRef(params);
  const searchParamsRef = useRef(searchParams);

  locationRef.current = location;
  paramsRef.current = params;
  searchParamsRef.current = searchParams;

  useLayoutEffect(() => {
    const legacyTopicId = searchParams.get('topic');

    if (!params.aid || !legacyTopicId) return;

    const normalizedTopicId = params.topicId ?? legacyTopicId;
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete('topic');

    const nextUrl = `${SESSION_CHAT_TOPIC_URL(params.aid, normalizedTopicId)}${getSearchSuffix(nextSearchParams)}${location.hash}`;
    const currentUrl = `${location.pathname}${location.search}${location.hash}`;

    if (currentUrl !== nextUrl) {
      navigate(nextUrl, { replace: true });
    }
  }, [
    location.hash,
    location.pathname,
    location.search,
    navigate,
    params.aid,
    params.topicId,
    searchParams,
  ]);

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
        setThread(!state ? null : state);
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
