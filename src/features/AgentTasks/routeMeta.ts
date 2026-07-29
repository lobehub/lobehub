import { ListTodoIcon } from 'lucide-react';

import { usePublishDynamicRouteMeta } from '@/features/RouteMeta/usePublishDynamicRouteMeta';
import { matchesRouteWorkspace, useRouteWorkspaceId } from '@/features/RouteMeta/workspaceScope';
import type { DynamicRouteMetaProps } from '@/spa/router/routeMeta';
import { routeMeta } from '@/spa/router/routeMeta';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

export const tasksRouteMeta = routeMeta({
  icon: ListTodoIcon,
  titleKey: 'navigation.tasks',
});

const TaskDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const routeWorkspaceId = useRouteWorkspaceId(params);
  const detail = useTaskStore((s) => {
    const item = taskDetailSelectors.taskDetailById(params.taskId ?? '')(s);
    return matchesRouteWorkspace(item?.workspaceId, routeWorkspaceId) ? item : undefined;
  });

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
  titleKey: 'navigation.task',
});
