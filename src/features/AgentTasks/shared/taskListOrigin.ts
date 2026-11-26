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
 * Where a crumb for `listPath` should lead: the carried origin when it is that
 * very list (so its filters survive), otherwise the bare `listPath`.
 *
 * History state is page-writable, so the origin is parsed rather than prefix
 * matched: anything that resolves off the parse base (`//host/…`, `/\host/…`,
 * `https://…`) or to another path falls back, and the returned target is
 * rebuilt from the parsed path, query and hash only.
 */
export const resolveTaskListCrumbTarget = (
  origin: string | undefined,
  listPath: string,
  slug: string | null | undefined,
): string => {
  if (!origin?.startsWith('/')) return listPath;

  let parsed: URL;
  try {
    parsed = new URL(origin, PARSE_BASE);
  } catch {
    return listPath;
  }
  if (parsed.origin !== PARSE_BASE) return listPath;
  if (parsed.pathname !== buildWorkspaceAwarePath(listPath, slug)) return listPath;

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
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
