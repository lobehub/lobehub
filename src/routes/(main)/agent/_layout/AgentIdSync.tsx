import { useEffect } from 'react';

import { useResolvedAgentRouteId } from '@/features/AgentRoute/useResolvedAgentRouteId';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';
import { useParams, useSearchParams } from '@/libs/router/navigation';
import { routerSelectors, useRouterStore } from '@/store/router';

import { useAgentIdStoreSync } from './useAgentIdStoreSync';

const AgentIdSync = () => {
  const params = useParams<{ aid?: string; topicId?: string }>('aid', 'topicId');
  const [searchParams] = useSearchParams();
  const navigate = useWorkspaceAwareNavigate();
  const pathname = useRouterStore(routerSelectors.pathname);
  const { agentId: activeId, isSlugRoute, resolvedAgentId } = useResolvedAgentRouteId(params.aid);

  // Hydrate from the route-owning component. Parent layouts can retain stale
  // params while sibling navigation changes the active agent, which leaves
  // agents absent from the regular sidebar list (for example project
  // coordinators) without a config and renders an empty conversation.
  useInitAgentConfig(activeId);

  // Redirect slug URL to real agent ID URL, preserving child path and query string
  useEffect(() => {
    if (isSlugRoute && resolvedAgentId) {
      const suffix = pathname.replace(`/agent/${params.aid}`, '');
      const qs = searchParams.toString();
      navigate(`/agent/${resolvedAgentId}${suffix}${qs ? `?${qs}` : ''}`, { replace: true });
    }
  }, [isSlugRoute, resolvedAgentId, navigate, searchParams, pathname, params.aid]);

  useAgentIdStoreSync({
    activeId,
    topicFromPath: params.topicId,
    topicFromQuery: searchParams.get('topic'),
  });

  return null;
};

export default AgentIdSync;
