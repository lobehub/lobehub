import type { ExplorerTreeNode, ExplorerTreeNodeComparator } from '@/features/ExplorerTree';
import type { AgentDocumentSort } from '@/store/global/initialState';

import type { AgentDocumentItem } from '../types';

type DocumentNode = ExplorerTreeNode<AgentDocumentItem>;

// Dates arrive as Date over superjson; tolerate a serialized string too.
const toTime = (value: Date | string | null | undefined): number =>
  value ? new Date(value).getTime() || 0 : 0;

const timeOf = (node: DocumentNode, by: 'createdAt' | 'updatedAt'): number => {
  const doc = node.data;
  if (!doc) return 0;
  if (by === 'createdAt') return toTime(doc.createdAt);
  // A rename or move touches the binding; a content edit only the document.
  return Math.max(toTime(doc.documentUpdatedAt), toTime(doc.updatedAt));
};

// A document holding sub-documents is a tree container drawn as a file; it
// sorts with the files, not the folders.
const isFolderRow = (node: DocumentNode) => !!node.isFolder && node.appearance !== 'file';

// Lower-cased text runs and numeric runs, so `week 2` sorts before `Week 10`.
const toNaturalTokens = (value: string): (number | string)[] =>
  value
    .toLowerCase()
    .split(/(\d+)/)
    .filter(Boolean)
    .map((token) => (/^\d+$/.test(token) ? Number(token) : token));

/**
 * The tree's own default name order (@pierre/trees): case-insensitive, numbers
 * by value, everything else by code unit. Keeping it means the default sort
 * draws exactly what the tree drew before a sort menu existed.
 */
export const compareNames = (a: string, b: string): number => {
  const left = toNaturalTokens(a);
  const right = toNaturalTokens(b);
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const l = left[index];
    const r = right[index];
    if (l === r) continue;
    if (typeof l === 'number' && typeof r === 'number') return l - r;
    return String(l) < String(r) ? -1 : 1;
  }
  if (left.length !== right.length) return left.length - right.length;
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

/**
 * Orders document tree siblings. Names use the tree's default order; time sorts
 * fall back to the name on ties.
 */
export const createDocumentComparator = (
  sort: AgentDocumentSort,
): ExplorerTreeNodeComparator<AgentDocumentItem> => {
  const direction = sort.order === 'asc' ? 1 : -1;

  return (a, b) => {
    if (sort.foldersFirst) {
      const aFolder = isFolderRow(a);
      if (aFolder !== isFolderRow(b)) return aFolder ? -1 : 1;
    }
    const byName = compareNames(a.name, b.name);
    const field = sort.by;
    if (field === 'name') return byName * direction;
    const byTime = timeOf(a, field) - timeOf(b, field);
    return byTime * direction || byName;
  };
};
