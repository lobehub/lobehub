import { mergeById } from './adapt';
import { type EntityLinks } from './link';
import { type MemoryActivity, type MemoryEntity } from './types';

export const groupByMonth = <T extends { activity: MemoryActivity }>(
  entries: T[],
  monthLabel: (iso: string) => string,
) => {
  const groups: { entries: T[]; label: string }[] = [];
  for (const entry of entries) {
    const label = monthLabel(entry.activity.when);
    const last = groups.at(-1);
    if (last?.label === label) last.entries.push(entry);
    else groups.push({ entries: [entry], label });
  }
  return groups;
};

/** When the page last moved: its newest linked activity, or its own last update. */
export const lastTouchedOf = (entity: MemoryEntity, links?: EntityLinks) => {
  const latest = links?.activities.get(entity.id)?.find((e) => !e.activity.planned)?.activity.when;
  return latest && latest > entity.updatedAt ? latest : entity.updatedAt;
};

const matchesKeyword = (entity: MemoryEntity, lower: string) =>
  [entity.title, entity.description, entity.summary, ...entity.tags].some((text) =>
    text.toLowerCase().includes(lower),
  );

/**
 * Contexts to show for a keyword: loaded ones that match locally, plus every server hit as is.
 * The server also searches fields the list does not hold (status, parent details), so its rows
 * are not filtered a second time.
 */
export const searchMatches = (
  contexts: MemoryEntity[],
  keyword: string,
  remote: MemoryEntity[] = [],
) => {
  const lower = keyword.trim().toLowerCase();
  if (!lower) return contexts;
  return mergeById(
    contexts.filter((e) => matchesKeyword(e, lower)),
    remote,
  );
};
