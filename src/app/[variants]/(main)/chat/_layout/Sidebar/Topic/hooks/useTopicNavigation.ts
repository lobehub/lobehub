import { usePathname } from 'next/navigation';
import { useCallback } from 'react';
import urlJoin from 'url-join';

import { useIsMobile } from '@/hooks/useIsMobile';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';

/**
 * Hook to handle topic navigation with automatic route detection
 * If in agent sub-route (e.g., /agent/:aid/profile), navigate back to chat first
 */
export const useTopicNavigation = () => {
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const activeAgentId = useChatStore((s) => s.activeAgentId);
  const router = useQueryRoute();
  const toggleConfig = useGlobalStore((s) => s.toggleMobileTopic);
  const [switchTopic, closeAllTopicsDrawer] = useChatStore((s) => [
    s.switchTopic,
    s.closeAllTopicsDrawer,
  ]);

  const isInAgentSubRoute = useCallback(() => {
    if (!activeAgentId) return false;
    const agentBasePath = `/agent/${activeAgentId}`;
    // If pathname has more segments after /agent/:aid, it's a sub-route
    return (
      pathname.startsWith(agentBasePath) &&
      pathname !== agentBasePath &&
      pathname !== `${agentBasePath}/`
    );
  }, [pathname, activeAgentId]);

  const navigateToTopic = useCallback(
    (topicId?: string) => {
      // If in agent sub-route, navigate back to agent chat first
      if (isInAgentSubRoute() && activeAgentId) {
        router.push(urlJoin('/agent', activeAgentId as string));
      }

      switchTopic(topicId);

      // Only close drawers/modals on mobile
      if (isMobile) {
        // Close AllTopicsDrawer if open
        closeAllTopicsDrawer();
        // Close mobile topic modal
        toggleConfig(false);
      }
    },
    [activeAgentId, router, switchTopic, toggleConfig, isInAgentSubRoute, closeAllTopicsDrawer, isMobile],
  );

  return {
    isInAgentSubRoute: isInAgentSubRoute(),
    navigateToTopic,
  };
};
