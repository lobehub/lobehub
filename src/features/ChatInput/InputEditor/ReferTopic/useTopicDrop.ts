import { TOPIC_DRAG_MIME } from '@lobechat/const';
import type React from 'react';
import { useCallback } from 'react';

import { useChatInputStore } from '../../store';
import { INSERT_REFER_TOPIC_COMMAND } from './ReferTopicPlugin';
import { readTopicDragData } from './topicDragData';

interface UseTopicDropResult {
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
}

/** Inserts a dragged sidebar topic using the same rich node as the @ topic picker. */
export const useTopicDrop = (): UseTopicDropResult => {
  const editor = useChatInputStore((state) => state.editor);

  const onDragOver = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(TOPIC_DRAG_MIME)) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes(TOPIC_DRAG_MIME)) return;

      const payload = readTopicDragData(event.dataTransfer);
      if (!payload) return;

      event.preventDefault();
      event.stopPropagation();

      if (!editor) return;

      editor.focus();
      editor.dispatchCommand(INSERT_REFER_TOPIC_COMMAND, payload);
    },
    [editor],
  );

  return { onDragOver, onDrop };
};
