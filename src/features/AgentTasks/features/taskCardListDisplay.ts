import type { TaskListItem } from '@/store/task/slices/list/initialState';

const MAX_DISPLAY = 5;

const toTime = (value: Date | string | null | undefined): number => {
  if (!value) return 0;
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
};

export const getVisibleTaskCardTasks = (tasks: TaskListItem[]) =>
  tasks.filter((task) => task.status !== 'completed');

export const getDisplayTaskCardTasks = (tasks: TaskListItem[]) =>
  [...getVisibleTaskCardTasks(tasks)]
    .sort((a, b) => {
      const updatedA = toTime(a.updatedAt) || toTime(a.createdAt);
      const updatedB = toTime(b.updatedAt) || toTime(b.createdAt);
      if (updatedA !== updatedB) return updatedB - updatedA;
      return a.identifier.localeCompare(b.identifier);
    })
    .slice(0, MAX_DISPLAY);
