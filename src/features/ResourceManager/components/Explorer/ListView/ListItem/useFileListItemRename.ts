import { App } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useEventCallback } from '@/hooks/useEventCallback';
import { useTreeStore } from '@/store/tree';

interface UseFileListItemRenameOptions {
  id: string;
  isFolder: boolean;
  isPendingRename?: boolean;
  libraryId?: string;
  name?: string | null;
  refreshFileList: (options?: { revalidateResources?: boolean }) => Promise<void>;
  setPendingRenameItemId: (id: string | null) => void;
  updateResource: (id: string, payload: { name: string }) => Promise<unknown>;
}

export const useFileListItemRename = ({
  id,
  isPendingRename,
  isFolder,
  libraryId,
  name,
  refreshFileList,
  setPendingRenameItemId,
  updateResource,
}: UseFileListItemRenameOptions) => {
  const { t } = useTranslation(['components', 'file']);
  const { message } = App.useApp();
  const [isRenaming, setIsRenaming] = useState(false);
  const [renamingValue, setRenamingValue] = useState(name || '');
  const inputRef = useRef<any>(null);
  const isConfirmingRef = useRef(false);

  const handleRenameStart = useCallback(() => {
    setIsRenaming(true);
    setRenamingValue(name || '');

    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, [name]);

  const handleRenameConfirm = useEventCallback(async () => {
    if (isConfirmingRef.current) return;
    isConfirmingRef.current = true;

    if (!renamingValue.trim()) {
      message.error(t('FileManager.actions.renameError'));
      isConfirmingRef.current = false;
      return;
    }

    if (renamingValue.trim() === name) {
      setIsRenaming(false);
      isConfirmingRef.current = false;
      return;
    }

    try {
      await updateResource(id, { name: renamingValue.trim() });
      // Revalidate tree for the parent folder — the explorer subscription will reconcile
      const { queryParams } = await import('@/store/file').then((m) => m.useFileStore.getState());
      const parentId = queryParams?.parentId ?? '';
      useTreeStore.getState().revalidate(parentId);
      await refreshFileList({ revalidateResources: false });

      message.success(t('FileManager.actions.renameSuccess'));
      setIsRenaming(false);
    } catch (error) {
      console.error('Rename error:', error);
      message.error(t('FileManager.actions.renameError'));
    } finally {
      isConfirmingRef.current = false;
    }
  });

  const handleRenameCancel = useCallback(() => {
    if (isConfirmingRef.current) return;
    setIsRenaming(false);
    setRenamingValue(name || '');
  }, [name]);

  useEffect(() => {
    if (isPendingRename && isFolder && !isRenaming) {
      handleRenameStart();
      setPendingRenameItemId(null);
    }
  }, [handleRenameStart, isFolder, isPendingRename, isRenaming, setPendingRenameItemId]);

  return {
    handleRenameCancel,
    handleRenameConfirm,
    handleRenameStart,
    inputRef,
    isRenaming,
    renamingValue,
    setRenamingValue,
  };
};
