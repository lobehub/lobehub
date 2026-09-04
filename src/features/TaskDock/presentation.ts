import type { DockTask, DockTaskStatus } from './type';

const ACTIVE: ReadonlySet<DockTaskStatus> = new Set(['pending', 'running']);

export type DockOverviewStatus = 'running' | 'success' | 'error' | 'cancelled';

export interface DockOverview {
  activeCount: number;
  /** 0-100 across the active tasks, or 100 once nothing is running. */
  progress: number;
  status: DockOverviewStatus;
}

export const isActiveTask = (task: DockTask): boolean => ACTIVE.has(task.status);

export const resolveDockOverview = (tasks: DockTask[]): DockOverview => {
  const active = tasks.filter(isActiveTask);

  const status: DockOverviewStatus =
    active.length > 0
      ? 'running'
      : tasks.some((task) => task.status === 'error')
        ? 'error'
        : tasks.some((task) => task.status === 'success')
          ? 'success'
          : 'cancelled';

  const progress =
    active.length === 0
      ? 100
      : active.reduce((total, task) => total + (task.progress ?? 0), 0) / active.length;

  return { activeCount: active.length, progress, status };
};

export const hasCancellableTask = (tasks: DockTask[]): boolean =>
  tasks.some((task) => isActiveTask(task) && !!task.cancel);

export interface DockTaskGroup {
  label: string;
  tasks: DockTask[];
}

/** Groups by `groupLabel`, keeping both the group order and the task order. */
export const groupDockTasks = (tasks: DockTask[]): DockTaskGroup[] => {
  const groups: DockTaskGroup[] = [];

  for (const task of tasks) {
    const group = groups.find((candidate) => candidate.label === task.groupLabel);
    if (group) group.tasks.push(task);
    else groups.push({ label: task.groupLabel, tasks: [task] });
  }

  return groups;
};

/**
 * A finished task with nothing to hand back has said all it can, so the dock
 * clears it. One that left a result — a published URL, a stored file — waits
 * for the user, and a failure always does.
 */
export const shouldAutoDismiss = (task: DockTask): boolean =>
  task.status === 'success' && !task.result;
