import { createContext, useContext, useMemo } from 'react';
import { useLocation } from 'react-router';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';

/**
 * The task list a task detail was opened from, as the full in-app URL of that
 * list (`pathname + search`, workspace prefix included, e.g.
 * `/lobehub/tasks?collection=mine`). It rides on the history entry's
 * `location.state`, so the breadcrumb can return to the filtered list instead
 * of the bare `/tasks`. Entries opened from anywhere else (home, command menu,
 * chat, deep links, new tabs) carry no origin and fall back to the plain list.
 */
export interface TaskListOriginState {
  taskListOrigin: string;
}

/** Provided by the task list page with its own current URL. */
export const TaskListOriginContext = createContext<string | undefined>(undefined);

const readOriginFromState = (state: unknown): string | undefined => {
  if (!state || typeof state !== 'object') return undefined;
  const origin = (state as Partial<TaskListOriginState>).taskListOrigin;
  return typeof origin === 'string' && origin.startsWith('/') ? origin : undefined;
};

/** The source list URL: the list page's own URL inside a list, else the one carried in history. */
export const useTaskListOrigin = (): string | undefined => {
  const contextOrigin = useContext(TaskListOriginContext);
  const location = useLocation();
  return contextOrigin ?? readOriginFromState(location.state);
};

/**
 * Navigation state to attach when opening a task detail, so the origin follows
 * the user from the list into the detail and on to related details.
 */
export const useTaskListOriginState = (): TaskListOriginState | undefined => {
  const origin = useTaskListOrigin();
  return useMemo(() => (origin ? { taskListOrigin: origin } : undefined), [origin]);
};

const originPathname = (origin: string): string => {
  const end = origin.search(/[?#]/);
  return end === -1 ? origin : origin.slice(0, end);
};

/**
 * Where a crumb for `listPath` should lead: the carried origin when it is that
 * very list (so its filters survive), otherwise the bare `listPath`.
 */
export const resolveTaskListCrumbTarget = (
  origin: string | undefined,
  listPath: string,
  slug: string | null | undefined,
): string => {
  if (!origin) return listPath;
  return originPathname(origin) === buildWorkspaceAwarePath(listPath, slug) ? origin : listPath;
};

export interface TaskListCrumbTarget {
  /** Already workspace-prefixed: pass to `WorkspaceLink` / `navigate` with `escape`. */
  escape: boolean;
  to: string;
}

export const useTaskListCrumbTarget = (listPath: string): TaskListCrumbTarget => {
  const origin = useTaskListOrigin();
  const slug = useActiveWorkspaceSlug();
  const to = resolveTaskListCrumbTarget(origin, listPath, slug);
  return { escape: to !== listPath, to };
};
