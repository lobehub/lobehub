import { AGENT_CHAT_TOPIC_URL, AGENT_CHAT_URL } from '@lobechat/const';
import { useCallback, useMemo } from 'react';
import { useParams } from 'react-router';
import urlJoin from 'url-join';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useFocusTopicPopup } from '@/features/TopicPopupGuard/useTopicPopupsRegistry';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { usePathname } from '@/libs/router/navigation';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';

import { buildPrefixedAgentRoutePath, parseAgentPathname } from '../../utils/agentPathname';

/**
 * Hook to handle topic navigation with automatic route detection
 * If in agent sub-route (e.g., /agent/:aid/profile), navigate back to chat first
 */
interface NavigateToTopicOptions {
  skipPopupFocus?: boolean;
}

export const useTopicNavigation = () => {
  const pathname = usePathname();
  const agentRoute = useMemo(() => parseAgentPathname(pathname), [pathname]);
  const params = useParams<{ aid?: string; topicId?: string }>();
  const [activeAgentId, activeTopicId] = useChatStore((s) => [s.activeAgentId, s.activeTopicId]);
  const router = useQueryRoute();
  const toggleConfig = useGlobalStore((s) => s.toggleMobileTopic);
  const switchTopic = useChatStore((s) => s.switchTopic);
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const routeAgentId = params.aid ?? agentRoute?.agentId ?? activeAgentId;
  // URL is the source of truth. Sidebar mounts at `/agent/:aid` so `params.topicId`
  // is undefined here — fall back to parsing pathname directly so consumers can compare
  // their item id against the URL's topic id without waiting for store hydration.
  const urlTopicId = params.topicId;
  const routeTopicId = params.topicId ?? activeTopicId ?? undefined;
  const focusTopicPopup = useFocusTopicPopup({ agentId: activeAgentId });

  const isInTopicContextRoute = useCallback(() => {
    if (!routeAgentId || !routeTopicId || agentRoute?.agentId !== routeAgentId) return false;

    return agentRoute.segmentsAfterAgent[0] === routeTopicId;
  }, [agentRoute, routeAgentId, routeTopicId]);

  const isInAgentSubRoute = useCallback(() => {
    if (!routeAgentId) return false;
    if (agentRoute?.agentId !== routeAgentId) return false;

    const { segmentsAfterAgent } = agentRoute;
    if (segmentsAfterAgent.length === 0) return false;

    const isExactTopicRoute =
      routeTopicId && segmentsAfterAgent.length === 1 && segmentsAfterAgent[0] === routeTopicId;

    // If pathname has more segments after /agent/:aid (or the active topic), it's a sub-route.
    return !isExactTopicRoute;
  }, [agentRoute, routeAgentId, routeTopicId]);

  const navigateToTopic = useCallback(
    async (topicId?: string, options?: NavigateToTopicOptions) => {
      if (!options?.skipPopupFocus) {
        await focusTopicPopup(topicId);
      }

      // If in agent sub-route, navigate back to agent chat first
      if (isInAgentSubRoute() && routeAgentId) {
        const basePath = topicId
          ? AGENT_CHAT_TOPIC_URL(routeAgentId, topicId)
          : AGENT_CHAT_URL(routeAgentId);
        const targetPath = buildPrefixedAgentRoutePath(basePath, agentRoute, activeWorkspaceSlug);

        // Include topicId in URL when navigating from sub-route
        router.push(targetPath);
        toggleConfig(false);
        return;
      }

      switchTopic(topicId);
      toggleConfig(false);
    },
    [
      activeWorkspaceSlug,
      agentRoute,
      focusTopicPopup,
      isInAgentSubRoute,
      routeAgentId,
      router,
      switchTopic,
      toggleConfig,
    ],
  );

  return {
    focusTopicPopup,
    isInAgentSubRoute: isInAgentSubRoute(),
    isInTopicContextRoute: isInTopicContextRoute(),
    navigateToTopic,
    routeTopicId,
    urlTopicId,
  };
};

export const useNavigateToAgentTopics = () => {
  const router = useQueryRoute();

  return useCallback(
    (agentId: string) => router.push(urlJoin('/agent', agentId, 'topics')),
    [router],
  );
};
