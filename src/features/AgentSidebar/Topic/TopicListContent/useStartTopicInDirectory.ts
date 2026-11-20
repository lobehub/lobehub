import { AGENT_CHAT_URL } from '@lobechat/const';
import { useCallback, useMemo } from 'react';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';

import { buildPrefixedAgentRoutePath, parseAgentPathname } from '../../utils/agentPathname';

/**
 * The agent sidebar's "start a topic in this project directory" action. The
 * directory pins the device, so nothing is committed to the agent default: the
 * blank composer opens with the directory staged, and the first send binds the
 * new topic to it.
 */
export const useStartTopicInDirectory = () => {
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const { aid: routeAgentId } = useActiveRouteParams<{ aid?: string }>();
  const { pathname } = useActiveLocation();
  const agentRoute = useMemo(() => parseAgentPathname(pathname), [pathname]);
  const agentId = routeAgentId ?? agentRoute?.agentId ?? activeAgentId;
  const router = useQueryRoute();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();

  const startInDirectory = useCallback(
    (projectWorkingDirectoryId: string) => {
      if (!agentId) return;
      useChatStore.getState().switchTopic(null, { skipRefreshMessage: true });
      useChatStore.getState().setPendingNewTopicDirectory({ agentId, projectWorkingDirectoryId });
      router.push(
        buildPrefixedAgentRoutePath(AGENT_CHAT_URL(agentId), agentRoute, activeWorkspaceSlug),
      );
    },
    [agentId, router, agentRoute, activeWorkspaceSlug],
  );

  return { agentId, startInDirectory };
};
