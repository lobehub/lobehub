import { useEffect } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router';

import { useResolvedAgentRouteId } from '@/features/AgentRoute/useResolvedAgentRouteId';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { useAgentIdStoreSync } from './useAgentIdStoreSync';

const AgentIdSync = () => {
  const params = useParams<{ aid?: string; topicId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useWorkspaceAwareNavigate();
  const location = useLocation();
  const { agentId: activeId, isBuiltinSlug, resolvedAgentId } = useResolvedAgentRouteId(params.aid);

  // Redirect slug URL to real agent ID URL, preserving child path and query string
  useEffect(() => {
    if (isBuiltinSlug && resolvedAgentId) {
      const suffix = location.pathname.replace(`/agent/${params.aid}`, '');
      const qs = searchParams.toString();
      navigate(`/agent/${resolvedAgentId}${suffix}${qs ? `?${qs}` : ''}`, { replace: true });
    }
  }, [isBuiltinSlug, resolvedAgentId, navigate, searchParams, location.pathname, params.aid]);

  useAgentIdStoreSync({
    activeId,
    topicFromPath: params.topicId,
    topicFromQuery: searchParams.get('topic'),
  });

  return null;
};

export default AgentIdSync;
