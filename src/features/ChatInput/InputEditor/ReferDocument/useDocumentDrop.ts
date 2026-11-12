import { AGENT_DOCUMENT_DRAG_MIME } from '@lobechat/const';
import type React from 'react';
import { useCallback } from 'react';

import { useChatInputStore } from '../../store';
import { readDocumentDragData } from './documentDragData';
import { INSERT_REFER_DOCUMENT_COMMAND } from './ReferDocumentPlugin';

interface UseDocumentDropResult {
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
}

/** Inserts an agent document dragged from the working sidebar as a reference chip. */
export const useDocumentDrop = (): UseDocumentDropResult => {
  const editor = useChatInputStore((state) => state.editor);

  const onDragOver = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(AGENT_DOCUMENT_DRAG_MIME)) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes(AGENT_DOCUMENT_DRAG_MIME)) return;

      const payload = readDocumentDragData(event.dataTransfer);
      if (!payload) return;

      event.preventDefault();
      event.stopPropagation();

      if (!editor) return;

      editor.focus();
      editor.dispatchCommand(INSERT_REFER_DOCUMENT_COMMAND, payload);
    },
    [editor],
  );

  return { onDragOver, onDrop };
};
