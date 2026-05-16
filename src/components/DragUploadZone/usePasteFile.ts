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
      // When copying from Excel, Word, or Sheets, the clipboard may contain both text/html (plus text/plain) and image/png.
      // In these cases, the image is just a preview for rendering and should be handled by the editor as rich text or table paste,
      // and should NOT trigger file upload. In the case of pure screenshot clipboard content, it usually only includes image/* and will not be affected.
      const types = event.clipboardData.types;
      const hasRichText = types.includes('text/html') || types.includes('text/plain');
      const hasFile = items.some((i) => i.kind === 'file');
      if (hasRichText && hasFile) return;
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
