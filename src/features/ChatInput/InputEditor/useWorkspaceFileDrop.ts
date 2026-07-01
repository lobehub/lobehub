import { WORKSPACE_FILE_DRAG_MIME } from '@lobechat/const';
import { INSERT_MENTION_COMMAND } from '@lobehub/editor';
import { $getSelection, $isRangeSelection } from 'lexical';
import type React from 'react';
import { useCallback } from 'react';

import { useChatInputStore } from '../store';
import { readWorkspaceFileDragData } from './workspaceFileDragData';

interface UseWorkspaceFileDropResult {
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
}

/**
 * Handles file/folder rows dragged from the working sidebar tree into the chat
 * input. Reacts only to the custom {@link WORKSPACE_FILE_DRAG_MIME} payload, so
 * it never interferes with the file-upload drop zone (keyed off `Files`) or the
 * skill-chip drop (keyed off its own MIME).
 *
 * On drop it inserts a `localFile` mention — identical to the `@`-menu and
 * folder-drop paths (see {@link insertLocalFolderMentions}) — instead of
 * uploading the file. The markdownWriter in InputEditor serializes it to
 * `<localFile name="..." path="..." isDirectory />`.
 */
export const useWorkspaceFileDrop = (): UseWorkspaceFileDropResult => {
  const editor = useChatInputStore((s) => s.editor);

  const onDragOver = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(WORKSPACE_FILE_DRAG_MIME)) return;
    // preventDefault marks this element as a valid drop target.
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes(WORKSPACE_FILE_DRAG_MIME)) return;
      const payload = readWorkspaceFileDragData(event.dataTransfer);
      if (!payload) return;

      event.preventDefault();
      event.stopPropagation();

      if (!editor) return;

      const lexicalEditor = editor.getLexicalEditor();
      lexicalEditor?.focus();

      editor.dispatchCommand(INSERT_MENTION_COMMAND, {
        label: payload.name,
        metadata: {
          isDirectory: payload.isDirectory,
          name: payload.name,
          path: payload.path,
          type: 'localFile',
        },
      });

      // Trailing space so the user can keep typing without adding one manually.
      lexicalEditor?.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          selection.insertText(' ');
        }
      });
    },
    [editor],
  );

  return { onDragOver, onDrop };
};
