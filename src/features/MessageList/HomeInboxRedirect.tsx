'use client';

import { AGENT_CHAT_URL } from '@lobechat/const';
import { Navigate } from 'react-router';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { resolveInboxAgentRouteId } from '@/features/AgentRoute/useResolvedAgentRouteId';
import { useImLayout } from '@/features/NavRail/useImLayout';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';

/**
 * The Web home route element. Under the `im_layout` trial the Messages tab
 * opens on the Lobe AI conversation, so `/` redirects there (replacing the
 * entry, so Back does not bounce). Rendered as the index route element rather
 * than from the layout, so it only runs once the router has hydrated and
 * cannot race the initial navigation. Off renders nothing: the layout shows
 * the home dashboard as before.
 */
const HomeInboxRedirect = () => {
  const imLayout = useImLayout();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);

  if (!imLayout) return null;

  const to = AGENT_CHAT_URL(resolveInboxAgentRouteId(inboxAgentId), false);
  return <Navigate replace to={buildWorkspaceAwarePath(to, activeWorkspaceSlug)} />;
};

export default HomeInboxRedirect;
