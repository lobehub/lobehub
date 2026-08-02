'use client';

import { useTranslation } from 'react-i18next';

import type { DynamicRouteMetaProps } from '@/spa/router/routeMeta';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';

import { usePublishDynamicRouteMeta } from './usePublishDynamicRouteMeta';
import { matchesRouteWorkspace, useRouteWorkspaceId } from './workspaceScope';

const useTopicTitle = (
  agentId: string | undefined,
  topicId: string | undefined,
  routeWorkspaceId: string | null | undefined,
): string | undefined =>
  useChatStore((state) => {
    if (!agentId || !topicId || routeWorkspaceId === undefined) return undefined;

    const topic = state.topicDataMap[topicMapKey({ agentId })]?.items?.find(
      (item) => item.id === topicId,
    );
    return topic?.title || undefined;
  });

const AgentDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const routeWorkspaceId = useRouteWorkspaceId(params);
  const meta = useAgentStore((state) => {
    const agentId = params.aid ?? '';
    const agent = state.agentMap[agentId];

    if (!matchesRouteWorkspace(agent?.workspaceId, routeWorkspaceId)) return {};

    return agentSelectors.getAgentMetaById(agentId)(state);
  });
  const topicTitle = useTopicTitle(params.aid, params.topicId ?? params.topic, routeWorkspaceId);
  const hasMeta = Object.keys(meta).length > 0;
  const agentTitle = hasMeta ? meta.title : undefined;

  usePublishDynamicRouteMeta(
    {
      avatar: meta.avatar,
      backgroundColor: meta.backgroundColor,
      title: [topicTitle, agentTitle].filter(Boolean).join(' · ') || undefined,
    },
    onResolve,
  );

  return null;
};

/**
 * Agent sub-pages (topics / profile / channel / stats) share the same title
 * shape: `<section label> · <agent name>`. The factory keeps them in sync.
 */
const createAgentSectionDynamicMeta = (titleKey: string) => {
  const AgentSectionDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
    const { t } = useTranslation('electron');
    // Widen the namespace-typed `t` so the factory can accept any key
    // (same approach as RouteMetaBridge's `translateTitleKey`).
    const translate = t as unknown as (key: string) => string;
    const routeWorkspaceId = useRouteWorkspaceId(params);
    const meta = useAgentStore((state) => {
      const agentId = params.aid ?? '';
      const agent = state.agentMap[agentId];

      if (!matchesRouteWorkspace(agent?.workspaceId, routeWorkspaceId)) return {};

      return agentSelectors.getAgentMetaById(agentId)(state);
    });
    const hasMeta = Object.keys(meta).length > 0;
    const agentTitle = hasMeta ? meta.title : undefined;

    usePublishDynamicRouteMeta(
      {
        avatar: meta.avatar,
        backgroundColor: meta.backgroundColor,
        title: [translate(titleKey), agentTitle].filter(Boolean).join(' · ') || undefined,
      },
      onResolve,
    );

    return null;
  };
  return AgentSectionDynamicMeta;
};

export const TopicsDynamicMeta = createAgentSectionDynamicMeta('navigation.topics');
export const ProfileDynamicMeta = createAgentSectionDynamicMeta('navigation.profile');
export const ChannelDynamicMeta = createAgentSectionDynamicMeta('navigation.channels');
export const StatisticsDynamicMeta = createAgentSectionDynamicMeta('navigation.stats');
export const PermissionDynamicMeta = createAgentSectionDynamicMeta('navigation.permission');

export default AgentDynamicMeta;
