import { SKILL_DRAG_MIME } from '@lobechat/const';
import type React from 'react';
import { useCallback } from 'react';

import { useChatInputStore } from '../../store';
import { INSERT_ACTION_TAG_COMMAND, type InsertActionTagPayload } from './command';
import { readSkillDragData } from './skillDragData';

interface UseSkillDropResult {
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
}

/**
 * Handles skill chips dragged from the working sidebar into the chat input.
 *
 * Reacts only to the custom {@link SKILL_DRAG_MIME} payload, so it never
 * interferes with the file-upload drop zone (which keys off the `Files` type).
 * On drop it inserts the matching action tag — identical to picking the skill
 * from the `/` menu.
 */
export const useSkillDrop = (): UseSkillDropResult => {
  const editor = useChatInputStore((s) => s.editor);

  const onDragOver = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(SKILL_DRAG_MIME)) return;
    // preventDefault marks this element as a valid drop target.
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes(SKILL_DRAG_MIME)) return;
      const payload = readSkillDragData(event.dataTransfer);
      if (!payload) return;

      event.preventDefault();
      event.stopPropagation();

      if (!editor) return;

      editor.focus();
      const command: InsertActionTagPayload = {
        category: payload.category,
        label: payload.label,
        type: payload.type,
      };
      editor.dispatchCommand(INSERT_ACTION_TAG_COMMAND, command);
    },
    [editor],
  );

  return { onDragOver, onDrop };
};
