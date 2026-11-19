import type { ChatContextContent } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import { useCallback } from 'react';

import type { PDFTextSelection } from '@/features/FileViewer/Renderer/PDF/textSelection';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors, displayMessageSelectors } from '@/store/chat/selectors';
import { useFileStore } from '@/store/file';

interface PreviewedFile {
  /** The stored file the agent can read back. */
  fileId: string;
  name: string;
}

export const createFileContextSelection = (
  file: PreviewedFile,
  selection: PDFTextSelection,
  id: string,
): ChatContextContent => ({
  content: selection.content,
  fileId: file.fileId,
  id,
  pageRange: selection.pageRange,
  source: 'file',
  title: file.name,
  type: 'text',
});

/**
 * Adds text selected in the previewed file to the composer of the conversation
 * the portal sits beside, as a removable chip that carries the file id and
 * pages to the agent.
 *
 * Returns nothing when that composer is not the one in view: a preview opened
 * from an isolated Topic (the Task run drawer) belongs to the drawer's
 * conversation, and a page without an active agent has no composer at all.
 */
export const useAddSelectionToChat = (file: PreviewedFile | undefined) => {
  const contextKey = useChatStore((s) =>
    s.activeAgentId && !chatPortalSelectors.previewFileSourceTopicId(s)
      ? displayMessageSelectors.currentDisplayChatKey(s)
      : undefined,
  );
  const fileId = file?.fileId;
  const fileName = file?.name;

  const addSelection = useCallback(
    (selection: PDFTextSelection) => {
      if (!contextKey || !fileId || !fileName) return;

      useFileStore.getState().addChatContextSelection({
        contextKey,
        selection: createFileContextSelection(
          { fileId, name: fileName },
          selection,
          `file-selection-${nanoid(6)}`,
        ),
      });
      // The chip appears in the composer; focusing it is the confirmation.
      useChatStore.getState().mainInputEditor?.focus();
    },
    [contextKey, fileId, fileName],
  );

  return contextKey && fileId ? addSelection : undefined;
};
