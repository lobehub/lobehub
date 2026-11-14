import type { sandboxStorageService } from '@/services/sandboxStorage';

export type StorageAnalysis = Awaited<ReturnType<typeof sandboxStorageService.analyzeStorage>>;
export type StorageAnalysisResult = NonNullable<StorageAnalysis['result']>;
export type StorageAnalysisItem = StorageAnalysisResult['items'][number];
export type StorageCategory = StorageAnalysisItem['category'];

/**
 * The categories in the order the view lists them: what can go without a
 * second thought first, the runtime's own snapshots last.
 */
export const STORAGE_CATEGORIES: StorageCategory[] = [
  'dependencies',
  'cache',
  'archives',
  'media',
  'git',
  'other',
  'environments',
];

/** Dependencies, caches and build output: rebuilt by the next install or build. */
export const isRegenerableCategory = (category: StorageCategory) =>
  category === 'dependencies' || category === 'cache';

/**
 * Environment snapshots are the runtime's own store. They are removed with
 * the environment they belong to, never as files.
 */
export const isDeletableItem = (item: Pick<StorageAnalysisItem, 'category'>) =>
  item.category !== 'environments';

const isWithin = (path: string, directory: string) =>
  path === directory || path.startsWith(`${directory}/`);

/**
 * The analysis with what was just deleted taken out, so the view reflects a
 * cleanup at once instead of waiting for a new scan. Exact for the items
 * themselves; a folder in the largest-folders list shrinks by the deleted
 * items it held.
 */
export const withoutDeleted = (
  result: StorageAnalysisResult,
  deleted: StorageAnalysisItem[],
): StorageAnalysisResult => {
  if (deleted.length === 0) return result;

  const gone = (path: string) => deleted.some((item) => isWithin(path, item.path));
  const freedBy = (category: StorageCategory) =>
    deleted.filter((item) => item.category === category).reduce((sum, item) => sum + item.bytes, 0);
  const freed = deleted.reduce((sum, item) => sum + item.bytes, 0);

  return {
    ...result,
    categories: result.categories.map((entry) => ({
      ...entry,
      bytes: Math.max(0, entry.bytes - freedBy(entry.category)),
      items: Math.max(
        0,
        entry.items - deleted.filter((item) => item.category === entry.category).length,
      ),
    })),
    items: result.items.filter((item) => !gone(item.path)),
    largestDirectories: result.largestDirectories
      .filter((entry) => !gone(entry.path))
      .map((entry) => ({
        ...entry,
        bytes: Math.max(
          0,
          entry.bytes -
            deleted
              .filter((item) => isWithin(item.path, entry.path))
              .reduce((sum, item) => sum + item.bytes, 0),
        ),
      }))
      .sort((a, b) => b.bytes - a.bytes),
    largestFiles: result.largestFiles.filter((entry) => !gone(entry.path)),
    totalBytes: Math.max(0, result.totalBytes - freed),
  };
};
