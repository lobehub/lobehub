import type { QuickNoteBucket } from '@/store/quickNote';
import { UNCATEGORIZED_KEY } from '@/store/quickNote';

export interface FilterChip {
  active: boolean;
  count?: number;
  key: string;
  label: string;
  onSelect: 'all' | 'uncategorized' | string;
}

export interface FilterChipsModel {
  collectionChips: FilterChip[];
  tagChips: FilterChip[];
}

export interface BuildFilterChipsOptions {
  activeCollection: string | null;
  activeTag: string | null;
  allLabel: string;
  collections: QuickNoteBucket[];
  tags: QuickNoteBucket[];
  uncategorizedCount: number;
  uncategorizedLabel: string;
}

const sortByCountDesc = (buckets: QuickNoteBucket[]) =>
  [...buckets].sort((a, b) => b.count - a.count);

export const buildFilterChips = ({
  activeCollection,
  activeTag,
  allLabel,
  collections,
  tags,
  uncategorizedCount,
  uncategorizedLabel,
}: BuildFilterChipsOptions): FilterChipsModel => {
  const collectionChips: FilterChip[] = [
    {
      active: !activeCollection && !activeTag,
      key: 'all',
      label: allLabel,
      onSelect: 'all',
    },
    ...sortByCountDesc(collections).map((collection) => ({
      active: activeCollection === collection.name,
      count: collection.count,
      key: collection.name,
      label: collection.name,
      onSelect: collection.name,
    })),
    ...(uncategorizedCount > 0
      ? [
          {
            active: activeCollection === UNCATEGORIZED_KEY,
            count: uncategorizedCount,
            key: UNCATEGORIZED_KEY,
            label: uncategorizedLabel,
            onSelect: 'uncategorized' as const,
          },
        ]
      : []),
  ];

  const tagChips: FilterChip[] = sortByCountDesc(tags).map((tag) => ({
    active: activeTag === tag.name,
    count: tag.count,
    key: tag.name,
    label: tag.name,
    onSelect: tag.name,
  }));

  return { collectionChips, tagChips };
};
