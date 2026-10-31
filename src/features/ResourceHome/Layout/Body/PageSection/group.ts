import { HTML_DOCUMENT_FILE_TYPE } from '@lobechat/const';

import type { DocsPageSectionView } from '@/store/global/initialState';
import { getTimeGroupId, sortTimeGroups } from '@/utils/client/topic';

import type { PageTreeRow } from './tree';

interface GroupableDoc {
  createdAt: Date;
  fileType: string;
  id: string;
  parentId?: string | null;
  updatedAt: Date;
}

export interface PageRowGroup<T extends GroupableDoc> {
  /** `all` when ungrouped, a time bucket id, or `page` / `artifact`. */
  id: string;
  rows: PageTreeRow<T>[];
}

/** Whether a page is an artifact: a self-contained HTML page, not rich text. */
export const isArtifactPage = (doc: { fileType?: string | null }): boolean =>
  doc.fileType === HTML_DOCUMENT_FILE_TYPE;

const TYPE_GROUP_ORDER = ['page', 'artifact'];

/**
 * Split tree rows into the section's groups. A sub-page stays under its parent,
 * so only top-level rows decide the group. Time buckets follow the sorted date
 * (`updatedAt` unless the list is sorted by creation); a title sort keeps the
 * A→Z order inside each bucket.
 */
export const groupPageRows = <T extends GroupableDoc>(
  rows: PageTreeRow<T>[],
  { groupBy, sortBy }: Pick<DocsPageSectionView, 'groupBy' | 'sortBy'>,
): PageRowGroup<T>[] => {
  if (groupBy === 'none') return rows.length > 0 ? [{ id: 'all', rows }] : [];

  const groupOf = (doc: T): string => {
    if (groupBy === 'byType') return isArtifactPage(doc) ? 'artifact' : 'page';

    const date = sortBy === 'createdAt' ? doc.createdAt : doc.updatedAt;
    return getTimeGroupId(new Date(date).getTime());
  };

  const groups = new Map<string, PageTreeRow<T>[]>();
  let current: PageTreeRow<T>[] = [];

  for (const row of rows) {
    if (row.depth === 0) {
      const id = groupOf(row.doc);
      current = groups.get(id) ?? [];
      groups.set(id, current);
    }
    current.push(row);
  }

  const result = [...groups].map(([id, groupRows]) => ({ id, rows: groupRows }));

  if (groupBy === 'byType') {
    return result.sort((a, b) => TYPE_GROUP_ORDER.indexOf(a.id) - TYPE_GROUP_ORDER.indexOf(b.id));
  }

  return sortTimeGroups(result);
};
