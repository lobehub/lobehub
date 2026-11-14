import type { ChannelListItem } from '@lobechat/types';

import type { ChannelListSort } from '@/store/global/initialState';

type SortableChannel = Pick<ChannelListItem, 'createdAt' | 'id' | 'title' | 'updatedAt'>;

const time = (value: Date | string | undefined) => (value ? new Date(value).getTime() : 0);

/**
 * Order a sidebar Channel section. A Channel never updated sorts by its creation time when
 * ordering by activity; ties keep the newest Channel first.
 */
export const sortChannels = <T extends SortableChannel>(
  channels: T[],
  { by, order }: ChannelListSort,
): T[] => {
  const direction = order === 'asc' ? 1 : -1;
  const compare = (a: T, b: T) => {
    if (by === 'title') return a.title.localeCompare(b.title);
    if (by === 'updatedAt')
      return time(a.updatedAt ?? a.createdAt) - time(b.updatedAt ?? b.createdAt);
    return time(a.createdAt) - time(b.createdAt);
  };
  return channels.toSorted(
    (a, b) => direction * compare(a, b) || time(b.createdAt) - time(a.createdAt),
  );
};
