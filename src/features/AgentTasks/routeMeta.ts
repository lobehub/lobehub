import { ListTodoIcon } from 'lucide-react';

import { matchesRouteWorkspace, useRouteWorkspaceId } from '@/features/RouteMeta/workspaceScope';
import { type DynamicRouteMeta, routeMeta } from '@/spa/router/routeMeta';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

export const tasksRouteMeta = routeMeta({
  icon: ListTodoIcon,
  titleKey: 'navigation.tasks',
});

export const taskRouteMeta = routeMeta({
  icon: ListTodoIcon,
  titleKey: 'navigation.task',
  useDynamicMeta: (params): DynamicRouteMeta => {
    const routeWorkspaceId = useRouteWorkspaceId(params);
    const detail = useTaskStore((s) => {
      const item = taskDetailSelectors.taskDetailById(params.taskId ?? '')(s);
      return matchesRouteWorkspace(item?.workspaceId, routeWorkspaceId) ? item : undefined;
    });

    return {
      title: detail?.name || undefined,
    };
  },
});
