import type {IEditor} from '@lobehub/editor';
import { useCallback, useEffect } from 'react';

import { getFileListFromDataTransferItems } from './useLocalDragUpload';

/**
 * Hook for handling paste file uploads via @lobehub/editor.
 * Listens to editor's onPaste event and extracts files from clipboard.
 *
 * @param editor - The editor instance from @lobehub/editor
 * @param onUploadFiles - Callback when files are pasted
 */
export const usePasteFile = (
  editor: IEditor | undefined,
  onUploadFiles: (files: File[]) => void | Promise<void>,
) => {
  const handlePaste = useCallback(
    async (event: ClipboardEvent) => {
      if (!event.clipboardData) return;

      const items = Array.from(event.clipboardData.items);
      const files = await getFileListFromDataTransferItems(items);

      if (files.length === 0) return;

      onUploadFiles(files);
    },
    [onUploadFiles],
  );

  useEffect(() => {
    if (!editor) return;

    editor.on('onPaste', handlePaste);

    return () => {
      editor.off('onPaste', handlePaste);
    };
  }, [editor, handlePaste]);
};
