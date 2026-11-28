import { createContext, useContext, useMemo } from 'react';
import { useLocation } from 'react-router';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';

import { resolveTaskCollection, type TaskCollection, taskCollectionParam } from './taskCollection';

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
  return typeof origin === 'string' ? origin : undefined;
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

// A fixed base only for parsing: the origin is an in-app path, never a full URL.
const PARSE_BASE = 'https://task-list-origin.invalid';

/**
 * The carried origin parsed as `listPath`, or `undefined` when it is another
 * page or not an in-app path at all.
 *
 * History state is page-writable, so the origin is parsed rather than prefix
 * matched: anything that resolves off the parse base (`//host/…`, `/\host/…`,
 * `https://…`) or to another path is rejected, and callers rebuild their target
 * from the parsed path, query and hash only.
 */
const parseTaskListOrigin = (
  origin: string | undefined,
  listPath: string,
  slug: string | null | undefined,
): URL | undefined => {
  if (!origin?.startsWith('/')) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(origin, PARSE_BASE);
  } catch {
    return undefined;
  }
  if (parsed.origin !== PARSE_BASE) return undefined;
  if (parsed.pathname !== buildWorkspaceAwarePath(listPath, slug)) return undefined;

  return parsed;
};

const toInAppPath = (parsed: URL) => `${parsed.pathname}${parsed.search}${parsed.hash}`;

/**
 * Where a crumb for `listPath` should lead: the carried origin when it is that
 * very list (so its filters survive), otherwise the bare `listPath`.
 */
export const resolveTaskListCrumbTarget = (
  origin: string | undefined,
  listPath: string,
  slug: string | null | undefined,
): string => {
  const parsed = parseTaskListOrigin(origin, listPath, slug);
  return parsed ? toInAppPath(parsed) : listPath;
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

const GLOBAL_TASK_LIST_PATH = '/tasks';

export interface TaskListRootCrumb extends TaskListCrumbTarget {
  /** The tab of the global task list the crumb leads to; it also names the crumb. */
  collection: TaskCollection;
}

/**
 * The root crumb of a task detail: the global list tab the detail was opened
 * from (My tasks, All tasks or Scheduled), its sub-view and filters included.
 * Without that origin it names and opens "All tasks". Where "My tasks" is
 * offered it owns the bare `/tasks`, so "All tasks" needs `collection=all`;
 * a bare link there would land on "My tasks" under an "All tasks" label.
 */
export const resolveTaskListRootCrumb = (
  origin: string | undefined,
  slug: string | null | undefined,
  options: { allowMine: boolean },
): TaskListRootCrumb => {
  const parsed = parseTaskListOrigin(origin, GLOBAL_TASK_LIST_PATH, slug);
  if (parsed) {
    return {
      collection: resolveTaskCollection(parsed.searchParams, options),
      escape: true,
      to: toInAppPath(parsed),
    };
  }

  const param = taskCollectionParam('tasks', options);
  return {
    collection: 'tasks',
    escape: false,
    to: param ? `${GLOBAL_TASK_LIST_PATH}?collection=${param}` : GLOBAL_TASK_LIST_PATH,
  };
};

export const useTaskListRootCrumb = (): TaskListRootCrumb => {
  const origin = useTaskListOrigin();
  const slug = useActiveWorkspaceSlug();
  // Mirrors the global task page: "My tasks" exists only inside a workspace.
  const allowMine = !!useActiveWorkspaceId();
  return resolveTaskListRootCrumb(origin, slug, { allowMine });
};
