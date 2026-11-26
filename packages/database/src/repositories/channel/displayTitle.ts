import type { ChannelMetadata } from '@lobechat/types';
import { and, inArray } from 'drizzle-orm';

import { projects } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { notTrashed } from '../../utils/softDelete';

interface TitledChannel {
  metadata: ChannelMetadata | null;
  projectId: string | null;
  title: string;
}

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
