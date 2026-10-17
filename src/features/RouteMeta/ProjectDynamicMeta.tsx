'use client';

import type { DynamicRouteMetaProps, RouteMetaParams } from '@/spa/router/routeMeta';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useProjectStore } from '@/store/project';

import { usePublishDynamicRouteMeta } from './usePublishDynamicRouteMeta';
import { matchesRouteWorkspace, useRouteWorkspaceId } from './workspaceScope';

export const useProjectConversationTitle = (params: RouteMetaParams): string | undefined => {
  const routeWorkspaceId = useRouteWorkspaceId(params);
  const projectName = useProjectStore((state) => {
    const detail = params.projectId ? state.projectDetailMap[params.projectId] : undefined;
    if (!matchesRouteWorkspace(detail?.project.workspaceId, routeWorkspaceId)) return undefined;
    return detail?.project.name || undefined;
  });
  const topicTitle = useChatStore((state) =>
    params.topicId ? topicSelectors.getTopicById(params.topicId)(state)?.title : undefined,
  );

  return [topicTitle, projectName].filter(Boolean).join(' · ') || undefined;
};

const ProjectConversationDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const title = useProjectConversationTitle(params);

  usePublishDynamicRouteMeta({ title }, onResolve);

  return null;
};

export default ProjectConversationDynamicMeta;
