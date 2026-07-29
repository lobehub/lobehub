import { useCallback, useMemo } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useIsWorkspaceOwner } from '@/business/client/hooks/useIsWorkspaceOwner';
import { useEventCallback } from '@/hooks/useEventCallback';
import { useResourceManagerStore } from '@/routes/(main)/resource/features/store';
import {
  getExplorerSelectAllUiState,
  getExplorerSelectedCount,
  isExplorerItemSelected,
} from '@/routes/(main)/resource/features/store/selectors';
import { useFileStore } from '@/store/file';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

interface ExplorerSelectionOptions {
  data: ExplorerSelectableItem[];
  hasMore: boolean;
}

interface ExplorerSelectableItem {
  id: string;
  userId?: string | null;
}

export const isExplorerItemSelectable = ({
  activeWorkspaceId,
  currentUserId,
  isWorkspaceOwner,
  itemUserId,
}: {
  activeWorkspaceId?: string | null;
  currentUserId?: string | null;
  isWorkspaceOwner: boolean;
  itemUserId?: string | null;
}) =>
  !activeWorkspaceId ||
  isWorkspaceOwner ||
  (!!currentUserId && !!itemUserId && currentUserId === itemUserId);

export const useExplorerSelectionEligibility = () => {
  const activeWorkspaceId = useActiveWorkspaceId();
  const isWorkspaceOwner = useIsWorkspaceOwner();
  const currentUserId = useUserStore(userProfileSelectors.userId);

  const isItemSelectable = useCallback(
    (item: ExplorerSelectableItem) =>
      isExplorerItemSelectable({
        activeWorkspaceId,
        currentUserId,
        isWorkspaceOwner,
        itemUserId: item.userId,
      }),
    [activeWorkspaceId, currentUserId, isWorkspaceOwner],
  );

  return {
    isItemSelectable,
    isWorkspaceMember: !!activeWorkspaceId && !isWorkspaceOwner,
    isWorkspaceOwner,
  };
};

export const useExplorerSelectionSummary = ({ data, hasMore }: ExplorerSelectionOptions) => {
  const [selectAllState, selectedFileIds, selectionTotal] = useResourceManagerStore((s) => [
    s.selectAllState,
    s.selectedFileIds,
    s.selectionTotal,
  ]);
  const { isItemSelectable, isWorkspaceMember, isWorkspaceOwner } =
    useExplorerSelectionEligibility();
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
    isWorkspaceMember,
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
