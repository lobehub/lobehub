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

export const TopicsDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const { t } = useTranslation('electron');
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
      title: [t('navigation.topics'), agentTitle].filter(Boolean).join(' · ') || undefined,
    },
    onResolve,
  );

  return null;
};

export default AgentDynamicMeta;
