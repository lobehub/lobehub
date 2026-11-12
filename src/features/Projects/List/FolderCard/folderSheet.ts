import type { ProjectOverview } from '@/store/project';

type OverviewTopic = ProjectOverview['recentTopics'][number];

/** Other topics listed under the headline; the paper has room for three rows. */
export const FOLDER_TOPIC_ROWS = 3;

/** More conversations than the front paper lists, or tasks, earn a second sheet edge. */
const RICH_TOPIC_COUNT = 3;

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
 * - `topics`: the latest conversation as its headline, the next few as rows;
 * - `intro`: the project brief, with a "no conversations yet" hint;
 * - `pending`: the brief alone while the overview loads, so a project with
 *   conversations never flashes the empty hint first;
 * - `unavailable`: the brief alone after the overview failed to load, without
 *   the loading placeholders, so a failed card does not look pending forever.
 */
export type FolderSheet =
  | { kind: 'intro' }
  | { kind: 'pending' }
  | { kind: 'unavailable' }
  | { kind: 'topics'; latest: OverviewTopic; others: OverviewTopic[] };

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

  const [latest, ...others] = overview?.recentTopics ?? [];
  if (!latest) return { kind: 'intro' };

  return { kind: 'topics', latest, others: others.slice(0, FOLDER_TOPIC_ROWS) };
};

/** A second paper edge peeks out behind the front one when the project holds more than it shows. */
export const isRichFolder = (overview: ProjectOverview | undefined): boolean =>
  !!overview && (overview.topicCount > RICH_TOPIC_COUNT || overview.taskCount > 0);
