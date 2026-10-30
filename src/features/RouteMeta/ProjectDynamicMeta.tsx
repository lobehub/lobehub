'use client';

import type { DynamicRouteMetaProps, RouteMetaParams } from '@/spa/router/routeMeta';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useProjectStore } from '@/store/project';

import { usePublishDynamicRouteMeta } from './usePublishDynamicRouteMeta';
import { matchesRouteWorkspace, useRouteWorkspaceId } from './workspaceScope';

interface ProjectIdentity {
  /** `null` once the project has loaded without a logo. */
  avatar?: string | null;
  name?: string;
}

const useProjectIdentity = (params: RouteMetaParams): ProjectIdentity => {
  const routeWorkspaceId = useRouteWorkspaceId(params);
  const project = useProjectStore((state) => {
    const detail = params.projectId ? state.projectDetailMap[params.projectId] : undefined;
    if (!matchesRouteWorkspace(detail?.project.workspaceId, routeWorkspaceId)) return undefined;
    return detail?.project;
  });

  if (!project) return {};

  return { avatar: project.avatar || null, name: project.name || undefined };
};

export const useProjectConversationTitle = (params: RouteMetaParams): string | undefined => {
  const { name: projectName } = useProjectIdentity(params);
  const topicTitle = useChatStore((state) =>
    params.topicId ? topicSelectors.getTopicById(params.topicId)(state)?.title : undefined,
  );

  return [topicTitle, projectName].filter(Boolean).join(' · ') || undefined;
};

/**
 * The project's own avatar, seeded from its name like every other project
 * avatar, so its tabs match the project switcher.
 */
export const useProjectTabAvatar = (params: RouteMetaParams) => {
  const { avatar, name } = useProjectIdentity(params);

  return { avatar, avatarSeed: name };
};

const ProjectConversationDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const title = useProjectConversationTitle(params);
  const avatar = useProjectTabAvatar(params);

  usePublishDynamicRouteMeta({ ...avatar, title }, onResolve);

  return null;
};

/** Project sections keep their static label and only take on the project's avatar. */
export const ProjectSectionDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  usePublishDynamicRouteMeta(useProjectTabAvatar(params), onResolve);

  return null;
};

export default ProjectConversationDynamicMeta;
