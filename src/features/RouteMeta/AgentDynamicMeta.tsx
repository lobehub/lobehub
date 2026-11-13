'use client';

import { agentDisplayName } from '@lobechat/types';
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

    // Archived (completed) topics are excluded from the list fetch — fall back
    // to the by-id detail cache filled by `useFetchTopicDetail`.
    const topic =
      state.topicDataMap[topicMapKey({ agentId })]?.items?.find((item) => item.id === topicId) ??
      state.topicDetailMap[topicId];
    return topic?.title || undefined;
  });

// Known from the route alone, so a background tab whose agent is not loaded still
// swaps a cached legacy default image for the generated character.
const agentAvatarIdentity = (agentId: string | undefined) =>
  agentId ? ({ avatarKind: 'agent', avatarSeed: agentId } as const) : undefined;

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
  const agentTitle = hasMeta ? agentDisplayName(meta) : undefined;

  usePublishDynamicRouteMeta(
    {
      avatar: hasMeta ? (meta.avatar ?? null) : undefined,
      ...agentAvatarIdentity(params.aid),
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
    const agentTitle = hasMeta ? agentDisplayName(meta) : undefined;

    usePublishDynamicRouteMeta(
      {
        avatar: hasMeta ? (meta.avatar ?? null) : undefined,
        ...agentAvatarIdentity(params.aid),
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
export const EngineDynamicMeta = createAgentSectionDynamicMeta('navigation.engine');
export const InstructionDynamicMeta = createAgentSectionDynamicMeta('navigation.instruction');
export const EnvironmentDynamicMeta = createAgentSectionDynamicMeta('navigation.environment');
export const ToolsDynamicMeta = createAgentSectionDynamicMeta('navigation.tools');
export const KnowledgeDynamicMeta = createAgentSectionDynamicMeta('navigation.knowledge');
export const SkillsDynamicMeta = createAgentSectionDynamicMeta('navigation.skills');
export const ChannelDynamicMeta = createAgentSectionDynamicMeta('navigation.channels');
export const StatisticsDynamicMeta = createAgentSectionDynamicMeta('navigation.stats');
export const ShareDynamicMeta = createAgentSectionDynamicMeta('navigation.agentShare');
export const SelfLearningDynamicMeta = createAgentSectionDynamicMeta('navigation.selfLearning');
export const PermissionDynamicMeta = createAgentSectionDynamicMeta('navigation.permission');

export default AgentDynamicMeta;
