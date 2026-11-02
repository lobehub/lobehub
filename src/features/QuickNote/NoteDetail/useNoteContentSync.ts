'use client';

import type { IEditor } from '@lobehub/editor';
import { useCallback } from 'react';

import { useQuickNoteStore } from '@/store/quickNote';

export const useNoteContentSync = (noteId: string, editor: IEditor | undefined) => {
  const updateNoteContent = useQuickNoteStore((s) => s.updateNoteContent);

  return useCallback(() => {
    updateNoteContent(
      noteId,
      String(editor?.getDocument('markdown') ?? ''),
      (editor?.getDocument('json') ?? {}) as Record<string, unknown>,
    );
  }, [editor, noteId, updateNoteContent]);
};
