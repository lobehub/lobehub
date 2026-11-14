import { useCallback, useMemo, useState } from 'react';

import {
  isDeletableItem,
  isRegenerableCategory,
  type StorageAnalysisItem,
  type StorageAnalysisResult,
} from './analysis';

/**
 * What the user has ticked for deletion, by path. Only items the current
 * analysis still lists count — one a cleanup already removed drops out — and
 * environment snapshots never do, since they are not deleted as files.
 */
export const useCleanupSelection = (result: StorageAnalysisResult | undefined) => {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const itemsByPath = useMemo(
    () => new Map((result?.items ?? []).map((item) => [item.path, item])),
    [result],
  );
  const chosen = useMemo(
    () =>
      [...selected]
        .map((path) => itemsByPath.get(path))
        .filter((item): item is StorageAnalysisItem => !!item && isDeletableItem(item)),
    [itemsByPath, selected],
  );

  const toggle = useCallback(
    (items: StorageAnalysisItem[], on: boolean) =>
      setSelected((current) => {
        const next = new Set(current);
        for (const item of items) {
          if (!isDeletableItem(item)) continue;
          if (on) next.add(item.path);
          else next.delete(item.path);
        }
        return next;
      }),
    [],
  );

  const clear = useCallback(() => setSelected(new Set()), []);

  return {
    bytes: chosen.reduce((sum, item) => sum + item.bytes, 0),
    chosen,
    clear,
    /** Every chosen item is a dependency directory, cache or build output. */
    regenerable: chosen.length > 0 && chosen.every((item) => isRegenerableCategory(item.category)),
    selected,
    toggle,
  };
};
