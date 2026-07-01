import { WORKSPACE_FILE_DRAG_MIME } from '@lobechat/const';
import type React from 'react';
import { useCallback } from 'react';

import { useChatInputStore } from '../store';
import { INSERT_LOCAL_FILE_MENTION_COMMAND } from './LocalFileMention';
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
 * On drop it inserts a `LocalFileMention` node — the same compact icon+name chip
 * used by the `@`-menu and folder-drop paths. That node owns its
 * `<localFile … />` markdown writer via an always-registered plugin, so the drop
 * serializes correctly even when the generic `mentionOption` writer is disabled
 * (e.g. the web client with no other mention categories).
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

      editor.getLexicalEditor()?.focus();
      editor.dispatchCommand(INSERT_LOCAL_FILE_MENTION_COMMAND, {
        isDirectory: payload.isDirectory,
        name: payload.name,
        path: payload.path,
      });
    },
    [editor],
  );

  return { onDragOver, onDrop };
};
