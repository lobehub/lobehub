import type { ProjectOverview } from '@/store/project';

type OverviewTask = ProjectOverview['recentTasks'][number];

/** Other tasks listed under the headline; the paper has room for three rows. */
export const FOLDER_TASK_ROWS = 3;

/** More tasks than the front paper lists earn a second sheet edge. */
const RICH_TASK_COUNT = FOLDER_TASK_ROWS + 1;

/**
 * Where the overview batch stands. A cached batch counts as `loaded` even when
 * its revalidation failed: the cards keep showing it.
 */
export type OverviewStatus = 'failed' | 'loaded' | 'loading';

export const resolveOverviewStatus = ({
  error,
  loaded,
}: {
  error: unknown;
  loaded: boolean;
}): OverviewStatus => (loaded ? 'loaded' : error ? 'failed' : 'loading');

/**
 * What the front paper of a folder card shows:
 * - `tasks`: the latest updated task as its headline, the next few as rows;
 * - `intro`: the project brief, with a "no tasks yet" hint;
 * - `pending`: the brief alone while the overview loads, so a project with
 *   tasks never flashes the empty hint first;
 * - `unavailable`: the brief alone after the overview failed to load, without
 *   the loading placeholders, so a failed card does not look pending forever.
 */
export type FolderSheet =
  | { kind: 'intro' }
  | { kind: 'pending' }
  | { kind: 'unavailable' }
  | { kind: 'tasks'; latest: OverviewTask; others: OverviewTask[] };

/**
 * @param overview the project's overview row, `undefined` when it has none
 * @param status where the overview batch stands
 */
export const resolveFolderSheet = (
  overview: ProjectOverview | undefined,
  status: OverviewStatus,
): FolderSheet => {
  if (!overview && status === 'loading') return { kind: 'pending' };
  if (!overview && status === 'failed') return { kind: 'unavailable' };

  const [latest, ...others] = overview?.recentTasks ?? [];
  if (!latest) return { kind: 'intro' };

  return { kind: 'tasks', latest, others: others.slice(0, FOLDER_TASK_ROWS) };
};

/** A second paper edge peeks out behind the front one when the project holds more than it shows. */
export const isRichFolder = (overview: ProjectOverview | undefined): boolean =>
  !!overview && overview.taskCount > RICH_TASK_COUNT;
