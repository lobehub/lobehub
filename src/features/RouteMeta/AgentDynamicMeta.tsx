'use client';

import { agentDisplayName } from '@lobechat/types';
import { useTranslation } from 'react-i18next';

import type { DynamicRouteMetaProps } from '@/spa/router/routeMeta';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { usePublishDynamicRouteMeta } from './usePublishDynamicRouteMeta';
import { useRouteTopicTitle } from './useRouteTopicTitle';
import { matchesRouteWorkspace, useRouteWorkspaceId } from './workspaceScope';

const AgentDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const routeWorkspaceId = useRouteWorkspaceId(params);
  const meta = useAgentStore((state) => {
    const agentId = params.aid ?? '';
    const agent = state.agentMap[agentId];

    if (!matchesRouteWorkspace(agent?.workspaceId, routeWorkspaceId)) return {};

    return agentSelectors.getAgentMetaById(agentId)(state);
  });
  const topicId = params.topicId ?? params.topic;
  const topicTitle = useRouteTopicTitle(topicId, routeWorkspaceId);
  const hasMeta = Object.keys(meta).length > 0;
  const agentTitle = hasMeta ? agentDisplayName(meta) : undefined;
  // While a named topic's row is missing (its list bucket replaced on
  // revalidation or a cache-scope switch), publish no title: the desktop tab
  // cache keeps any non-empty title, so the bare agent name would overwrite
  // the topic title for good.
  const topicPending = !!topicId && topicTitle === undefined;

  usePublishDynamicRouteMeta(
    {
      avatar: meta.avatar,
      backgroundColor: meta.backgroundColor,
      title: topicPending
        ? undefined
        : [topicTitle, agentTitle].filter(Boolean).join(' · ') || undefined,
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
    const agentTitle = hasMeta ? agentDisplayName(meta) : undefined;

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
export const ShareDynamicMeta = createAgentSectionDynamicMeta('navigation.agentShare');
export const SelfLearningDynamicMeta = createAgentSectionDynamicMeta('navigation.selfLearning');
export const PermissionDynamicMeta = createAgentSectionDynamicMeta('navigation.permission');

export default AgentDynamicMeta;
