import type { ChannelListItem } from '@lobechat/types';

type HintedChannel = Pick<ChannelListItem, 'createdAt' | 'id' | 'memberAvatars' | 'title'>;

/** Member names a hint lists; more would push the Channel's own name out of the row. */
const LISTED_MEMBERS = 2;

/**
 * A short hint for each Channel whose name another Channel in the same list shares, so rows that
 * read alike can be told apart (the `General` Channels left by several deleted projects, say). A
 * row gets the first kind of hint no other same-named row shares: who else is in it, else the day
 * it was created, else that day and time. A Channel whose name is its own gets none.
 */
export const duplicateTitleHints = (
  channels: HintedChannel[],
  { locale, separator }: { locale: string; separator: string },
): Map<string, string> => {
  const groups = new Map<string, HintedChannel[]>();
  for (const channel of channels) {
    const key = channel.title.trim();
    groups.set(key, [...(groups.get(key) ?? []), channel]);
  }

  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const dayAndTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const kinds: Array<(channel: HintedChannel) => string> = [
    ({ memberAvatars }) =>
      (memberAvatars ?? [])
        .map(({ name }) => name?.trim())
        .filter(Boolean)
        .slice(0, LISTED_MEMBERS)
        .join(separator),
    ({ createdAt }) => day.format(new Date(createdAt)),
    ({ createdAt }) => dayAndTime.format(new Date(createdAt)),
  ];

  const hints = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Rows still alike after one kind of hint try the next; the last kind is kept regardless.
    let alike = group;
    kinds.forEach((kind, level) => {
      const values = alike.map(kind);
      const last = level === kinds.length - 1;
      alike = alike.filter((channel, index) => {
        const value = values[index];
        const own = !!value && values.indexOf(value) === values.lastIndexOf(value);
        if (own || last) hints.set(channel.id, value);
        return !own && !last;
      });
    });
  }
  return hints;
};
