import type { TrashProjectFilter } from '@lobechat/types';

import { normalizeAsyncError } from '@/libs/swr/normalizeError';

/** Picker values of the two filters that are not a project; project ids never look like these. */
export const PROJECT_FILTER_ALL = '__all__';
export const PROJECT_FILTER_NONE = '__none__';

export const toProjectFilterValue = (projectId: TrashProjectFilter): string =>
  projectId === undefined
    ? PROJECT_FILTER_ALL
    : projectId === null
      ? PROJECT_FILTER_NONE
      : projectId;

export const fromProjectFilterValue = (value: string): TrashProjectFilter =>
  value === PROJECT_FILTER_ALL ? undefined : value === PROJECT_FILTER_NONE ? null : value;

/**
 * Whether the selected project filter can be acted on:
 *
 * - `available` — All, No project, or a project the loaded project list holds.
 * - `unknown` — a project while the project list has not loaded yet: the bin
 *   may be read (the server checks access on every request) but nothing may be
 *   swept on its behalf.
 * - `unavailable` — the loaded project list no longer holds it (deleted, or
 *   access lost), or the server refused it as a filter.
 */
export type ProjectFilterAvailability = 'available' | 'unavailable' | 'unknown';

export const resolveProjectAvailability = ({
  projectId,
  projects,
  refused = false,
}: {
  projectId: TrashProjectFilter;
  /** The live project list of the current scope; `undefined` until it loads. */
  projects: { id: string }[] | undefined;
  refused?: boolean;
}): ProjectFilterAvailability => {
  if (typeof projectId !== 'string') return 'available';
  if (refused) return 'unavailable';
  if (!projects) return 'unknown';
  return projects.some((project) => project.id === projectId) ? 'available' : 'unavailable';
};

/**
 * "Empty" sweeps every root the view covers, so it is only offered on a
 * settled view: a confirmed project (never one that is still loading or gone),
 * loaded counts to show what will be purged, and no failed request whose
 * stale rows could misstate it.
 */
export const canEmptyTrashView = ({
  availability,
  filterCount,
  hasError,
  itemCount,
}: {
  availability: ProjectFilterAvailability;
  /** Roots the view covers; `undefined` while the counts are not loaded. */
  filterCount: number | undefined;
  hasError: boolean;
  itemCount: number;
}): boolean => availability === 'available' && !hasError && itemCount > 0 && !!filterCount;

/** The server refused the project filter: the project is gone or no longer readable. */
export const isProjectRefusedError = (error: unknown): boolean =>
  !!error && normalizeAsyncError(error).code === 'NOT_FOUND';

/** The server refused an "empty trash" batch because the active workspace changed mid-sweep. */
export const isScopeChangedError = (error: unknown): boolean =>
  !!error && normalizeAsyncError(error).code === 'PRECONDITION_FAILED';
