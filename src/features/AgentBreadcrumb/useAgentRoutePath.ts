import { useCallback, useMemo } from 'react';
import { useLocation } from 'react-router';
import urlJoin from 'url-join';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import {
  buildPrefixedAgentRoutePath,
  parseAgentPathname,
} from '@/features/AgentSidebar/utils/agentPathname';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';

/**
 * Builds links that stay inside the current agent's route family, keeping the
 * workspace slug and whatever prefix the current pathname already carries.
 * Calling the returned builder with no segment yields the agent home; pass
 * segments for a sub-page, e.g. `buildAgentPath('goals')`.
 */
export const useAgentRoutePath = (agentId: string) => {
  const { pathname } = useLocation();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const agentRoute = useMemo(() => parseAgentPathname(pathname), [pathname]);

  return useCallback(
    (...segments: string[]) => {
      const targetPath = buildWorkspaceAwarePath(
        urlJoin('/agent', agentId, ...segments),
        activeWorkspaceSlug,
      );
      return buildPrefixedAgentRoutePath(targetPath, agentRoute, activeWorkspaceSlug);
    },
    [activeWorkspaceSlug, agentId, agentRoute],
  );
};
