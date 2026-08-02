'use client';

import { useTranslation } from 'react-i18next';

import type { DynamicRouteMetaProps } from '@/spa/router/routeMeta';
import { useChatStore } from '@/store/chat';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';
import { useSessionStore } from '@/store/session';
import { sessionGroupSelectors } from '@/store/session/slices/sessionGroup/selectors';

import { usePublishDynamicRouteMeta } from './usePublishDynamicRouteMeta';
import { matchesRouteWorkspace, useRouteWorkspaceId } from './workspaceScope';

const getWorkspaceId = (item: unknown): string | null | undefined =>
  (item as { workspaceId?: string | null } | undefined)?.workspaceId;

const useTopicTitle = (
  groupId: string | undefined,
  topicId: string | undefined,
  routeWorkspaceId: string | null | undefined,
): string | undefined =>
  useChatStore((state) => {
    if (!groupId || !topicId || routeWorkspaceId === undefined) return undefined;

    const topic = state.topicDataMap[topicMapKey({ groupId })]?.items?.find(
      (item) => item.id === topicId,
    );
    return topic?.title || undefined;
  });

const GroupDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const routeWorkspaceId = useRouteWorkspaceId(params);
  const group = useSessionStore((state) => {
    const item = sessionGroupSelectors.getGroupById(params.gid ?? '')(state);
    return matchesRouteWorkspace(getWorkspaceId(item), routeWorkspaceId) ? item : undefined;
  });
  const topicTitle = useTopicTitle(params.gid, params.topicId ?? params.topic, routeWorkspaceId);

  usePublishDynamicRouteMeta(
    {
      title: topicTitle || group?.name || undefined,
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

export default GroupDynamicMeta;
