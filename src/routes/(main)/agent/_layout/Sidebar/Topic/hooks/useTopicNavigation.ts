import { useCallback } from 'react';
import { useParams } from 'react-router-dom';

import { SESSION_CHAT_TOPIC_URL, SESSION_CHAT_URL } from '@/const/url';
import { useFocusTopicPopup } from '@/features/TopicPopupGuard/useTopicPopupsRegistry';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { usePathname } from '@/libs/router/navigation';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';

/**
 * Hook to handle topic navigation with automatic route detection
 * If in agent sub-route (e.g., /agent/:aid/profile), navigate back to chat first
 */
interface NavigateToTopicOptions {
  skipPopupFocus?: boolean;
}

export const useTopicNavigation = () => {
  const pathname = usePathname();
  const params = useParams<{ aid?: string; topicId?: string }>();
  const [activeAgentId, activeTopicId] = useChatStore((s) => [s.activeAgentId, s.activeTopicId]);
  const router = useQueryRoute();
  const toggleConfig = useGlobalStore((s) => s.toggleMobileTopic);
  const switchTopic = useChatStore((s) => s.switchTopic);
  const routeAgentId = params.aid ?? activeAgentId;
  const routeTopicId = params.topicId ?? activeTopicId ?? undefined;
  const topicBasePath =
    routeAgentId && routeTopicId ? SESSION_CHAT_TOPIC_URL(routeAgentId, routeTopicId) : undefined;
  // URL-derived topic path (no store fallback) — used for sub-route detection so a cached
  // activeTopicId cannot mask a non-topic page like /agent/:aid/profile.
  const urlTopicBasePath =
    routeAgentId && params.topicId
      ? SESSION_CHAT_TOPIC_URL(routeAgentId, params.topicId)
      : undefined;
  const focusTopicPopup = useFocusTopicPopup({ agentId: activeAgentId });

  const isInTopicContextRoute = useCallback(() => {
    if (!topicBasePath) return false;

    return (
      pathname === topicBasePath ||
      pathname === `${topicBasePath}/` ||
      pathname.startsWith(`${topicBasePath}/`)
    );
  }, [pathname, topicBasePath]);

  const isInAgentSubRoute = useCallback(() => {
    if (!routeAgentId) return false;
    const agentBasePath = urlTopicBasePath ?? SESSION_CHAT_URL(routeAgentId);

    // If pathname has more segments after /agent/:aid (or the active topic), it's a sub-route
    return (
      pathname.startsWith(agentBasePath) &&
      pathname !== agentBasePath &&
      pathname !== `${agentBasePath}/`
    );
  }, [pathname, routeAgentId, urlTopicBasePath]);

  const navigateToTopic = useCallback(
    async (topicId?: string, options?: NavigateToTopicOptions) => {
      if (!options?.skipPopupFocus) {
        await focusTopicPopup(topicId);
      }

      // If in agent sub-route, navigate back to agent chat first
      if (isInAgentSubRoute() && routeAgentId) {
        const basePath = topicId
          ? SESSION_CHAT_TOPIC_URL(routeAgentId, topicId)
          : SESSION_CHAT_URL(routeAgentId);

        // Include topicId in URL when navigating from sub-route
        router.push(basePath);
        toggleConfig(false);
        return;
      }

      switchTopic(topicId);
      toggleConfig(false);
    },
    [focusTopicPopup, isInAgentSubRoute, routeAgentId, router, switchTopic, toggleConfig],
  );

  return {
    focusTopicPopup,
    isInAgentSubRoute: isInAgentSubRoute(),
    isInTopicContextRoute: isInTopicContextRoute(),
    navigateToTopic,
    routeTopicId,
  };
};
