import { CHANNEL_LIMITS, type ChannelMetadata } from '@lobechat/types';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { channels, projects } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { notTrashed } from '../../utils/softDelete';

interface TitledChannel {
  metadata: ChannelMetadata | null;
  projectId: string | null;
  title: string;
}

/** The title a project's default Channel is created with; members can rename it. */
export const PROJECT_DEFAULT_CHANNEL_TITLE = 'General';

/** The marked Channel a project starts with; see `ChannelMetadata.projectDefault`. */
export const isProjectDefaultChannel = (channel: Pick<TitledChannel, 'metadata' | 'projectId'>) =>
  !!channel.projectId && channel.metadata?.projectDefault === true;

/** The metadata a project's default Channel is created with. */
export const projectDefaultChannelMetadata = (): ChannelMetadata => ({ projectDefault: true });

/**
 * Adds `displayTitle`: the project's name for a project's default Channel while that project is
 * live and named, otherwise the Channel's own `title`. Read every time, so a project rename shows
 * at once; one query for every marked row, none when no row is marked.
 */
export const withDisplayTitles = async <T extends TitledChannel>(
  db: LobeChatDatabase | Transaction,
  rows: T[],
): Promise<Array<T & { displayTitle: string }>> => {
  const projectIds = [
    ...new Set(rows.filter(isProjectDefaultChannel).map(({ projectId }) => projectId!)),
  ];
  const nameOf = new Map<string, string>();
  if (projectIds.length) {
    const found = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(inArray(projects.id, projectIds), notTrashed(projects.isDeleted)));
    for (const { id, name } of found) if (name?.trim()) nameOf.set(id, name.trim());
  }
  return rows.map((row) => ({
    ...row,
    displayTitle: (isProjectDefaultChannel(row) && nameOf.get(row.projectId!)) || row.title,
  }));
};

export const withDisplayTitle = async <T extends TitledChannel>(
  db: LobeChatDatabase | Transaction,
  row: T,
): Promise<T & { displayTitle: string }> => (await withDisplayTitles(db, [row]))[0];

/**
 * Run before a project is deleted: each of its Channels still titled
 * {@link PROJECT_DEFAULT_CHANNEL_TITLE} takes the project's name. Deleting the project keeps its
 * Channels as standalone ones (`channels.project_id` is `set null`), where the `General` Channels of
 * several deleted projects could no longer be told apart. A Channel a member renamed keeps its
 * name, and `updatedAt` is left alone so the rename does not count as activity.
 */
export const nameChannelsAfterDeletedProject = async (
  db: LobeChatDatabase | Transaction,
  projectId: string,
  projectName: string | null,
) => {
  // The server counts UTF-16 units, as for any Channel title; never cut a character in half.
  let title = '';
  for (const char of projectName?.trim() ?? '') {
    if (title.length + char.length > CHANNEL_LIMITS.titleLength) break;
    title += char;
  }
  title = title.trim();
  if (!title) return;

  await db
    .update(channels)
    .set({ title, updatedAt: sql`${channels.updatedAt}` })
    .where(
      and(eq(channels.projectId, projectId), eq(channels.title, PROJECT_DEFAULT_CHANNEL_TITLE)),
    );
};
