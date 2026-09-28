import { useCallback, useMemo } from 'react';

import { useIsWorkspaceOwner } from '@/business/client/hooks/useIsWorkspaceOwner';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import {
  getExplorerSelectAllUiState,
  getExplorerSelectedCount,
  isExplorerItemSelected,
} from '@/features/ResourceManager/store/selectors';
import { useEventCallback } from '@/hooks/useEventCallback';
import { useFileStore } from '@/store/file';

interface ExplorerSelectionOptions {
  data: ExplorerSelectableItem[];
  hasMore: boolean;
}

interface ExplorerSelectableItem {
  id: string;
}

export const isExplorerItemSelectable = (_item?: ExplorerSelectableItem) => true;

export const useExplorerSelectionEligibility = () => {
  const isWorkspaceOwner = useIsWorkspaceOwner();

  return {
    isItemSelectable: isExplorerItemSelectable,
    isWorkspaceOwner,
  };
};

export const useExplorerSelectionSummary = ({ data, hasMore }: ExplorerSelectionOptions) => {
  const [selectAllState, selectedFileIds, selectionTotal] = useResourceManagerStore((s) => [
    s.selectAllState,
    s.selectedFileIds,
    s.selectionTotal,
  ]);
  const { isItemSelectable, isWorkspaceOwner } = useExplorerSelectionEligibility();
  const selectableData = useMemo(() => data.filter(isItemSelectable), [data, isItemSelectable]);
  const total = useFileStore((s) => s.total);
  const effectiveTotal = selectionTotal ?? total;
  const selectedCount = useMemo(
    () =>
      getExplorerSelectedCount({
        selectAllState,
        selectedIds: selectedFileIds,
        total: effectiveTotal,
      }),
    [effectiveTotal, selectAllState, selectedFileIds],
  );

  const uiState = useMemo(
    () =>
      getExplorerSelectAllUiState({
        data: selectableData,
        hasMore,
        selectAllState,
        selectedIds: selectedFileIds,
      }),
    [hasMore, selectableData, selectAllState, selectedFileIds],
  );

  return {
    ...uiState,
    hasSelectableItems: selectableData.length > 0,
    isWorkspaceOwner,
    selectableCount: selectableData.length,
    selectedCount,
    selectAllState,
    selectedFileIds,
    total: effectiveTotal,
  };
};

export const useExplorerSelectionActions = (data: ExplorerSelectableItem[]) => {
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
  const { isItemSelectable } = useExplorerSelectionEligibility();
  const selectableData = useMemo(() => data.filter(isItemSelectable), [data, isItemSelectable]);

  const handleSelectAll = useEventCallback((checked?: boolean) => {
    const store = useResourceManagerStore.getState();
    const allLoadedSelected =
      selectableData.length > 0 &&
      selectableData.every((item) =>
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
      const loadedIds = new Set(selectableData.map((item) => item.id));
      const nextExcludedIds = store.selectedFileIds.filter((id) => !loadedIds.has(id));

      if (nextExcludedIds.length !== store.selectedFileIds.length) {
        setSelectedFileIds(nextExcludedIds);
      }

      return;
    }

    selectAllLoadedResources(selectableData.map((item) => item.id));
  });

  const handleSelectAllResources = useCallback(async () => {
    await selectAllResources();
  }, [selectAllResources]);

  const toggleItemSelection = useCallback(
    (id: string, checked: boolean) => {
      const item = data.find((entry) => entry.id === id);
      if (!item || !isItemSelectable(item)) return;

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
    [clearSelectAllState, data, isItemSelectable, setSelectedFileIds],
  );

  return {
    clearSelectAllState,
    handleSelectAll,
    handleSelectAllResources,
    isItemSelectable,
    selectAllState,
    selectedFileIds,
    setSelectedFileIds,
    toggleItemSelection,
  };
};
