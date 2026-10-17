import { type IEditor } from '@lobehub/editor';
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

/**
 * Window-level variant of usePasteFile for surfaces without an editor
 * instance (e.g. the plain textarea on the generation pages). Mirrors the
 * chat-side paste semantics: only file payloads are handled and the event is
 * never prevented, so plain text pastes stay untouched.
 *
 * @param onUploadFiles - Callback when files are pasted
 * @param options - disabled: detach the listener entirely
 */
export const useWindowPasteFile = (
  onUploadFiles: (files: File[]) => void | Promise<void>,
  options?: { disabled?: boolean },
) => {
  const disabled = options?.disabled ?? false;

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
    if (disabled) return;

    window.addEventListener('paste', handlePaste);

    return () => {
      window.removeEventListener('paste', handlePaste);
    };
  }, [disabled, handlePaste]);
};
