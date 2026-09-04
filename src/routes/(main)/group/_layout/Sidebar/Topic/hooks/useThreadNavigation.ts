import { useCallback } from 'react';
import urlJoin from 'url-join';

import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useParams } from '@/libs/router/navigation';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { routerSelectors, useRouterStore } from '@/store/router';

/**
 * Hook to handle thread navigation with automatic route detection
 * If in agent sub-route (e.g., /agent/:aid/profile), navigate back to chat first
 */
export const useThreadNavigation = () => {
  const pathname = useRouterStore(routerSelectors.pathname);
  const params = useParams('aid');
  const router = useQueryRoute();
  const toggleConfig = useGlobalStore((s) => s.toggleMobileTopic);
  const switchThread = useChatStore((s) => s.switchThread);

  const isInAgentSubRoute = useCallback(() => {
    if (!params.aid) return false;
    const agentBasePath = `/agent/${params.aid}`;
    // If pathname has more segments after /agent/:aid, it's a sub-route
    return (
      pathname.startsWith(agentBasePath) &&
      pathname !== agentBasePath &&
      pathname !== `${agentBasePath}/`
    );
  }, [pathname, params.aid]);

  const navigateToThread = useCallback(
    (threadId: string) => {
      // If in agent sub-route, navigate back to agent chat first
      if (isInAgentSubRoute() && params.aid) {
        router.push(urlJoin('/agent', params.aid as string));
      }

      switchThread(threadId);
      toggleConfig(false);
    },
    [params.aid, router, switchThread, toggleConfig, isInAgentSubRoute],
  );

  return {
    isInAgentSubRoute: isInAgentSubRoute(),
    navigateToThread,
  };
};
