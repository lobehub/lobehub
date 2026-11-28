'use client';

import { agentDisplayName } from '@lobechat/types';
import { useTranslation } from 'react-i18next';

import type { DynamicRouteMetaProps } from '@/spa/router/routeMeta';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { usePublishDynamicRouteMeta } from './usePublishDynamicRouteMeta';
import { useRouteTopicTitle } from './useRouteTopicTitle';
import { matchesRouteWorkspace, useRouteWorkspaceId } from './workspaceScope';

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
      avatar: hasMeta ? (meta.avatar ?? null) : undefined,
      ...agentAvatarIdentity(params.aid),
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
export const OpeningDynamicMeta = createAgentSectionDynamicMeta('navigation.opening');
export const GraphDynamicMeta = createAgentSectionDynamicMeta('navigation.graph');
export const PermissionDynamicMeta = createAgentSectionDynamicMeta('navigation.permission');
export const DocumentsDynamicMeta = createAgentSectionDynamicMeta('navigation.document');
export const GoalsDynamicMeta = createAgentSectionDynamicMeta('navigation.goals');
export const TasksDynamicMeta = createAgentSectionDynamicMeta('navigation.tasks');
export const MailDynamicMeta = createAgentSectionDynamicMeta('navigation.mail');
export const AutomationsDynamicMeta = createAgentSectionDynamicMeta('navigation.automations');
export const WebhookDynamicMeta = createAgentSectionDynamicMeta('navigation.webhook');

export default AgentDynamicMeta;
