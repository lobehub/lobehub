import { pinyin } from 'pinyin-pro';

import { type KnowledgeItem, KnowledgeType } from '@/types/knowledgeBase';

/** Which half of the picker is open: libraries or standalone files. */
export type PickerKind = 'file' | 'library';

/** How a tab orders its rows: by name either way, or newest change / creation first. */
export type PickerSort = 'createdAt' | 'name' | 'nameDesc' | 'updatedAt';

/**
 * Files an agent cannot read when it answers: media has no text to chunk and search. The server
 * already drops images; audio and video still come through and used to bury the libraries.
 */
const UNSEARCHABLE_FILE_PREFIXES = ['image/', 'video/', 'audio/'];

export const isSearchableFile = (item: KnowledgeItem) =>
  !UNSEARCHABLE_FILE_PREFIXES.some((prefix) => item.fileType?.startsWith(prefix));

const kindType = (kind: PickerKind) =>
  kind === 'library' ? KnowledgeType.KnowledgeBase : KnowledgeType.File;

/**
 * Rows of one kind that the agent could actually search. A media file attached before this filter
 * existed stays listed, so it can still be removed from here.
 */
export const itemsOfKind = (items: KnowledgeItem[], kind: PickerKind) =>
  items.filter(
    (item) =>
      item.type === kindType(kind) &&
      (item.type !== KnowledgeType.File || item.enabled || isSearchableFile(item)),
  );

const timeOf = (value?: Date | string) => (value ? new Date(value).getTime() : 0);

/**
 * Names compare by their first letters, so a Chinese name files under its pinyin (产品 → C)
 * between Latin names instead of collecting before or after all of them.
 */
const nameKey = (name: string) =>
  /\p{Script=Han}/u.test(name)
    ? pinyin(name, { nonZh: 'consecutive', toneType: 'none', type: 'array' }).join('')
    : name;

const compareNames = (a: KnowledgeItem, b: KnowledgeItem) =>
  nameKey(a.name).localeCompare(nameKey(b.name), 'en', { numeric: true, sensitivity: 'base' });

const compareBy =
  (sort: PickerSort) =>
  (a: KnowledgeItem, b: KnowledgeItem): number => {
    switch (sort) {
      case 'name': {
        return compareNames(a, b);
      }
      case 'nameDesc': {
        return compareNames(b, a);
      }
      case 'createdAt': {
        return timeOf(b.createdAt) - timeOf(a.createdAt);
      }
      default: {
        return timeOf(b.updatedAt) - timeOf(a.updatedAt);
      }
    }
  };

/**
 * What the picker shows for a tab and a search: only that kind, matched by name, ordered by the
 * chosen sort, with the ones already attached first so the member sees what the agent has before
 * what it could have.
 */
export const filterPickerItems = ({
  items,
  keyword,
  kind,
  sort = 'updatedAt',
}: {
  items: KnowledgeItem[];
  keyword?: string;
  kind: PickerKind;
  sort?: PickerSort;
}): KnowledgeItem[] => {
  const query = keyword?.trim().toLowerCase();
  const matched = itemsOfKind(items, kind)
    .filter((item) => !query || item.name.toLowerCase().includes(query))
    .sort(compareBy(sort));

  return [...matched.filter((item) => item.enabled), ...matched.filter((item) => !item.enabled)];
};
