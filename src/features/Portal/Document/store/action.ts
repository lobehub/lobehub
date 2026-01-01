'use client';

import { EDITOR_DEBOUNCE_TIME, EDITOR_MAX_WAIT } from '@lobechat/const';
import debug from 'debug';
import { debounce } from 'es-toolkit/compat';
import { type StateCreator } from 'zustand';

import { useNotebookStore } from '@/store/notebook';

import { type DocumentEditorState, initialDocumentEditorState } from './initialState';

const log = debug('portal:document-editor');

export interface DocumentEditorAction {
  flushSave: () => void;
  handleContentChange: () => void;
  handleTitleSubmit: () => Promise<void>;
  performSave: () => Promise<void>;
  setCurrentTitle: (title: string) => void;
}

export type DocumentEditorStore = DocumentEditorState & DocumentEditorAction;

const createDebouncedSave = (get: () => DocumentEditorStore) =>
  debounce(
    async () => {
      try {
        await get().performSave();
      } catch (error) {
        log('Failed to auto-save:', error);
      }
    },
    EDITOR_DEBOUNCE_TIME,
    { leading: false, maxWait: EDITOR_MAX_WAIT, trailing: true },
  );

export const createDocumentEditorStore: (
  initState?: Partial<DocumentEditorState>,
) => StateCreator<DocumentEditorStore> = (initState) => (set, get) => {
  const debouncedSave = createDebouncedSave(get);

  return {
    ...initialDocumentEditorState,
    ...initState,

    flushSave: () => {
      debouncedSave.flush();
    },

    handleContentChange: () => {
      const { editor, lastSavedContent } = get();
      if (!editor) return;

      try {
        const markdownContent = (editor.getDocument('markdown') as unknown as string) || '';
        const contentChanged = markdownContent !== lastSavedContent;

        set({ isDirty: contentChanged });

        if (contentChanged) {
          debouncedSave();
        }
      } catch (error) {
        log('Failed to update content:', error);
      }
    },

    handleTitleSubmit: async () => {
      const { performSave, editor } = get();
      await performSave();
      editor?.focus();
    },

    performSave: async () => {
      const { editor, documentId, topicId, isDirty, currentTitle } = get();

      if (!editor || !documentId || !topicId) return;

      if (!isDirty) return;

      set({ saveStatus: 'saving' });

      try {
        const currentContent = (editor.getDocument('markdown') as unknown as string) || '';

        await useNotebookStore.getState().updateDocument(
          {
            content: currentContent,
            id: documentId,
            title: currentTitle || undefined,
          },
          topicId,
        );

        set({
          isDirty: false,
          lastSavedContent: currentContent,
          lastUpdatedTime: new Date(),
          saveStatus: 'saved',
        });

        log('Document saved successfully:', documentId);
      } catch (error) {
        log('Failed to save document:', error);
        set({ saveStatus: 'idle' });
      }
    },

    setCurrentTitle: (title: string) => {
      set({ currentTitle: title, isDirty: true });
      debouncedSave();
    },
  };
};
