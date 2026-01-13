import { usePathname } from 'next/navigation';
import { useCallback } from 'react';

import { useAgentGroupStore } from '@/store/agentGroup';
import { useGlobalStore } from '@/store/global';

/**
 * Hook to handle topic navigation with automatic route detection
 * If in agent sub-route (e.g., /agent/:aid/profile), navigate back to chat first
 */
export const useTopicNavigation = () => {
  const pathname = usePathname();
  const activeGroupId = useAgentGroupStore((s) => s.activeGroupId);
  const toggleConfig = useGlobalStore((s) => s.toggleMobileTopic);
  const switchTopic = useAgentGroupStore((s) => s.switchTopic);

  const isInAgentSubRoute = useCallback(() => {
    if (!activeGroupId) return false;
    const agentBasePath = `/group/${activeGroupId}`;
    // If pathname has more segments after /agent/:aid, it's a sub-route
    return (
      pathname.startsWith(agentBasePath) &&
      pathname !== agentBasePath &&
      pathname !== `${agentBasePath}/`
    );
  }, [pathname, activeGroupId]);

  const navigateToTopic = useCallback(
    (topicId?: string) => {
      switchTopic(topicId);
      toggleConfig(false);
    },
    [switchTopic, toggleConfig],
  );

  return {
    isInAgentSubRoute: isInAgentSubRoute(),
    navigateToTopic,
  };
};
