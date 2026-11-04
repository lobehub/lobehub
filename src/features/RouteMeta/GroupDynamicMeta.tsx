'use client';

import { useTranslation } from 'react-i18next';

import type { DynamicRouteMetaProps } from '@/spa/router/routeMeta';
import { useSessionStore } from '@/store/session';
import { sessionGroupSelectors } from '@/store/session/slices/sessionGroup/selectors';

import { usePublishDynamicRouteMeta } from './usePublishDynamicRouteMeta';
import { useRouteTopicTitle } from './useRouteTopicTitle';
import { matchesRouteWorkspace, useRouteWorkspaceId } from './workspaceScope';

const getWorkspaceId = (item: unknown): string | null | undefined =>
  (item as { workspaceId?: string | null } | undefined)?.workspaceId;

const GroupDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const routeWorkspaceId = useRouteWorkspaceId(params);
  const group = useSessionStore((state) => {
    const item = sessionGroupSelectors.getGroupById(params.gid ?? '')(state);
    return matchesRouteWorkspace(getWorkspaceId(item), routeWorkspaceId) ? item : undefined;
  });
  const topicId = params.topicId ?? params.topic;
  const topicTitle = useRouteTopicTitle(topicId, routeWorkspaceId);
  // Same rule as AgentDynamicMeta: a missing topic row must not let the group
  // name overwrite the desktop tab's cached topic title.
  const topicPending = !!topicId && topicTitle === undefined;

  usePublishDynamicRouteMeta(
    {
      title: topicPending ? undefined : topicTitle || group?.name || undefined,
    },
    onResolve,
  );

  return null;
};

export const GroupProfileDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const { t } = useTranslation('electron');
  const routeWorkspaceId = useRouteWorkspaceId(params);
  const group = useSessionStore((state) => {
    const item = sessionGroupSelectors.getGroupById(params.gid ?? '')(state);
    return matchesRouteWorkspace(getWorkspaceId(item), routeWorkspaceId) ? item : undefined;
  });

  usePublishDynamicRouteMeta(
    {
      title: [t('navigation.groupProfile'), group?.name].filter(Boolean).join(' · ') || undefined,
    },
    onResolve,
  );

  return null;
};

export const GroupPermissionDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const { t } = useTranslation('electron');
  const routeWorkspaceId = useRouteWorkspaceId(params);
  const group = useSessionStore((state) => {
    const item = sessionGroupSelectors.getGroupById(params.gid ?? '')(state);
    return matchesRouteWorkspace(getWorkspaceId(item), routeWorkspaceId) ? item : undefined;
  });

  usePublishDynamicRouteMeta(
    {
      title: [t('navigation.permission'), group?.name].filter(Boolean).join(' · ') || undefined,
    },
    onResolve,
  );

  return null;
};

export default GroupDynamicMeta;
