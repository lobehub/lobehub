'use client';

import { AGENT_CHAT_URL } from '@lobechat/const';
import { useEffect } from 'react';
import { useLocation } from 'react-router';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { resolveInboxAgentRouteId } from '@/features/AgentRoute/useResolvedAgentRouteId';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';

export const isHomePath = (pathname: string, activeWorkspaceSlug: string | null) =>
  pathname === '/' ||
  (!!activeWorkspaceSlug &&
    (pathname === `/${activeWorkspaceSlug}` || pathname === `/${activeWorkspaceSlug}/`));

/**
 * In the rail layout the Messages tab opens on the Lobe AI conversation, so the
 * bare home path lands there (replacing the entry, so Back does not bounce).
 */
const HomeInboxRedirect = () => {
  const { pathname } = useLocation();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const navigate = useWorkspaceAwareNavigate();
  const isHome = isHomePath(pathname, activeWorkspaceSlug);

  useEffect(() => {
    if (!isHome) return;
    navigate(AGENT_CHAT_URL(resolveInboxAgentRouteId(inboxAgentId), false), { replace: true });
  }, [inboxAgentId, isHome, navigate]);

  return null;
};

export default HomeInboxRedirect;
