import { ListTodoIcon } from 'lucide-react';

import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import TasksSkeleton from '@/components/Skeleton/Tasks';
import { usePublishDynamicRouteMeta } from '@/features/RouteMeta/usePublishDynamicRouteMeta';
import { matchesRouteWorkspace, useRouteWorkspaceId } from '@/features/RouteMeta/workspaceScope';
import { useTaskDetailProjection } from '@/projection/modules/task/viewHooks';
import type { DynamicRouteMetaProps } from '@/spa/router/routeMeta';
import { routeMeta } from '@/spa/router/routeMeta';

export const tasksRouteMeta = routeMeta({
  icon: ListTodoIcon,
  Skeleton: TasksSkeleton,
  titleKey: 'navigation.tasks',
});

const TaskDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const routeWorkspaceId = useRouteWorkspaceId(params);
  const projectedDetail = useTaskDetailProjection(params.taskId);
  const detail = matchesRouteWorkspace(projectedDetail?.workspaceId, routeWorkspaceId)
    ? projectedDetail
    : undefined;

  usePublishDynamicRouteMeta(
    {
      title: detail?.name || undefined,
    },
    onResolve,
  );

  return null;
};

export const taskRouteMeta = routeMeta({
  DynamicMeta: TaskDynamicMeta,
  icon: ListTodoIcon,
  Skeleton: createSurfaceSkeleton('detail'),
  titleKey: 'navigation.task',
});
