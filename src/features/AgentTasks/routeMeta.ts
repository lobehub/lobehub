import { ListTodoIcon } from 'lucide-react';

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
    const detail = useTaskStore(taskDetailSelectors.taskDetailById(params.taskId ?? ''));

    return {
      title: detail?.name || undefined,
    };
  },
});
