import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { useMount, usePrevious, useUnmount } from 'ahooks';
import { useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { createStoreUpdater } from '@/store/utils/createStoreUpdater';

const BUILTIN_SLUG_SET = new Set<string>(Object.values(BUILTIN_AGENT_SLUGS));

const AgentIdSync = () => {
  const useStoreUpdater = createStoreUpdater(useAgentStore);
  const useChatStoreUpdater = createStoreUpdater(useChatStore);
  const params = useParams<{ aid?: string; topicId?: string }>();
  const [searchParams] = useSearchParams();
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;
  const navigate = useNavigate();
  const location = useLocation();

  // Resolve builtin agent slug to real agent ID
  const isBuiltinSlug = !!params.aid && BUILTIN_SLUG_SET.has(params.aid);
  const resolvedId = useAgentStore(
    builtinAgentSelectors.getBuiltinAgentId(isBuiltinSlug ? params.aid! : ''),
  );

  // Redirect slug URL to real agent ID URL, preserving child path and query string
  useEffect(() => {
    if (isBuiltinSlug && resolvedId) {
      const suffix = location.pathname.replace(`/agent/${params.aid}`, '');
      const qs = searchParams.toString();
      navigate(`/agent/${resolvedId}${suffix}${qs ? `?${qs}` : ''}`, { replace: true });
    }
  }, [isBuiltinSlug, resolvedId, navigate, searchParams, location.pathname, params.aid]);

  // Use resolved ID when available, fall back to URL param (e.g. anonymous mode)
  const activeId = useMemo(
    () => (isBuiltinSlug ? resolvedId || params.aid : params.aid),
    [isBuiltinSlug, resolvedId, params.aid],
  );

  const prevAgentId = usePrevious(activeId);

  useStoreUpdater('activeAgentId', activeId);
  useChatStoreUpdater('activeAgentId', activeId);

  // Reset activeTopicId when switching to a different agent
  // This prevents messages from being saved to the wrong topic bucket
  useEffect(() => {
    // Only reset topic when switching between agents (not on initial mount)
    if (prevAgentId !== undefined && prevAgentId !== activeId) {
      useChatStore.getState().clearPortalStack();

      // Preserve topic if the URL already carries one (e.g. tab navigation)
      const topicFromUrl = params.topicId ?? searchParamsRef.current.get('topic');

      if (!topicFromUrl) {
        useChatStore.getState().switchTopic(null, { skipRefreshMessage: true });
      }
    }
    // Note: we no longer clear all unread topics on agent visit — the badge counts
    // unread topics and is cleared per-topic when the user actually opens each one.
  }, [activeId, prevAgentId]);

  useMount(() => {
    useChatStore.setState({ activeAgentId: activeId }, false, 'AgentIdSync/mountAgentId');
  });

  // Clear activeAgentId when unmounting (leaving chat page)
  useUnmount(() => {
    useAgentStore.setState({ activeAgentId: undefined }, false, 'AgentIdSync/unmountAgentId');
    useChatStore.setState(
      { activeAgentId: undefined, activeTopicId: undefined },
      false,
      'AgentIdSync/unmountAgentId',
    );
  });

  return null;
};

export default AgentIdSync;
