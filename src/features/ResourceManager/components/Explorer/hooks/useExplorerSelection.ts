import { useCallback, useMemo } from 'react';

import { useEventCallback } from '@/hooks/useEventCallback';
import { useResourceManagerStore } from '@/routes/(main)/resource/features/store';
import {
  getExplorerSelectAllUiState,
  getExplorerSelectedCount,
  isExplorerItemSelected,
} from '@/routes/(main)/resource/features/store/selectors';
import { useFileStore } from '@/store/file';

interface ExplorerSelectionOptions {
  data: Array<{ id: string }>;
  hasMore: boolean;
}

export const useExplorerSelectionSummary = ({ data, hasMore }: ExplorerSelectionOptions) => {
  const [selectAllState, selectedFileIds] = useResourceManagerStore((s) => [
    s.selectAllState,
    s.selectedFileIds,
  ]);
  const total = useFileStore((s) => s.total);
  const selectedCount = useMemo(
    () => getExplorerSelectedCount({ selectAllState, selectedIds: selectedFileIds, total }),
    [selectAllState, selectedFileIds, total],
  );

  const uiState = useMemo(
    () =>
      getExplorerSelectAllUiState({
        data,
        hasMore,
        selectAllState,
        selectedIds: selectedFileIds,
      }),
    [data, hasMore, selectAllState, selectedFileIds],
  );

  return {
    ...uiState,
    selectedCount,
    selectAllState,
    selectedFileIds,
    total,
  };
};

export const useExplorerSelectionActions = (data: Array<{ id: string }>) => {
  const [
    clearSelectAllState,
    selectAllLoadedResources,
    selectAllResources,
    setSelectedFileIds,
    selectedFileIds,
    selectAllState,
  ] = useResourceManagerStore((s) => [
    s.clearSelectAllState,
    s.selectAllLoadedResources,
    s.selectAllResources,
    s.setSelectedFileIds,
    s.selectedFileIds,
    s.selectAllState,
  ]);

  const handleSelectAll = useEventCallback((checked?: boolean) => {
    const store = useResourceManagerStore.getState();
    const allLoadedSelected =
      data.length > 0 &&
      data.every((item) =>
        isExplorerItemSelected({
          id: item.id,
          selectAllState: store.selectAllState,
          selectedIds: store.selectedFileIds,
        }),
      );

    if (checked === false || (store.selectAllState !== 'all' && allLoadedSelected)) {
      clearSelectAllState();
      return;
    }

    if (store.selectAllState === 'all') {
      const loadedIds = new Set(data.map((item) => item.id));
      const nextExcludedIds = store.selectedFileIds.filter((id) => !loadedIds.has(id));

      if (nextExcludedIds.length !== store.selectedFileIds.length) {
        setSelectedFileIds(nextExcludedIds);
      }

      return;
    }

    selectAllLoadedResources(data.map((item) => item.id));
  });

  const handleSelectAllResources = useCallback(() => {
    selectAllResources();
  }, [selectAllResources]);

  const toggleItemSelection = useCallback(
    (id: string, checked: boolean) => {
      const { selectAllState: currentSelectAllState, selectedFileIds: currentSelected } =
        useResourceManagerStore.getState();

      if (currentSelectAllState === 'all') {
        if (checked) {
          if (!currentSelected.includes(id)) return;
          setSelectedFileIds(currentSelected.filter((item) => item !== id));
          return;
        }

        if (currentSelected.includes(id)) return;
        setSelectedFileIds([...currentSelected, id]);
        return;
      }

      clearSelectAllState();

      if (checked) {
        if (currentSelected.includes(id)) return;
        setSelectedFileIds([...currentSelected, id]);
        return;
      }

      setSelectedFileIds(currentSelected.filter((item) => item !== id));
    },
    [clearSelectAllState, setSelectedFileIds],
  );

  return {
    clearSelectAllState,
    handleSelectAll,
    handleSelectAllResources,
    selectAllState,
    selectedFileIds,
    setSelectedFileIds,
    toggleItemSelection,
  };
};
