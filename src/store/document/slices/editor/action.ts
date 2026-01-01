import { EDITOR_DEBOUNCE_TIME, EDITOR_MAX_WAIT } from '@lobechat/const';
import { type IEditor } from '@lobehub/editor';
import { debounce } from 'es-toolkit/compat';
import { type StateCreator } from 'zustand/vanilla';

import { setNamespace } from '@/utils/storeDebug';

import type { DocumentStore } from '../../store';

const n = setNamespace('document/editor');

export interface EditorAction {
  /**
   * Close the current document
   */
  closeDocument: () => void;
  /**
   * Flush any pending debounced save
   */
  flushSave: () => void;
  /**
   * Handle content change from editor
   */
  handleContentChange: () => void;
  /**
   * Called when editor is initialized
   */
  onEditorInit: () => void;
  /**
   * Open a document for editing
   */
  openDocument: (params: {
    content: string;
    documentId: string;
    title: string;
    topicId: string;
  }) => void;
  /**
   * Perform save operation
   */
  performSave: () => Promise<void>;
  /**
   * Set editor instance
   */
  setEditor: (editor: IEditor | undefined) => void;
  /**
   * Set editor state
   */
  setEditorState: (editorState: any) => void;
  /**
   * Set edit mode
   */
  setMode: (mode: 'edit' | 'preview') => void;
  /**
   * Update document title
   */
  setTitle: (title: string) => void;
}

// Create debounced save outside store
let debouncedSave: ReturnType<typeof debounce> | null = null;

const createDebouncedSave = (get: () => DocumentStore) => {
  if (debouncedSave) return debouncedSave;

  debouncedSave = debounce(
    async () => {
      try {
        await get().performSave();
      } catch (error) {
        console.error('[DocumentEditor] Failed to auto-save:', error);
      }
    },
    EDITOR_DEBOUNCE_TIME,
    { leading: false, maxWait: EDITOR_MAX_WAIT, trailing: true },
  );

  return debouncedSave;
};

export const createEditorSlice: StateCreator<
  DocumentStore,
  [['zustand/devtools', never]],
  [],
  EditorAction
> = (set, get) => ({
  closeDocument: () => {
    // Flush any pending saves before closing
    const save = createDebouncedSave(get);
    save.flush();

    set(
      {
        activeContent: '',
        activeDocumentId: undefined,
        activeTopicId: undefined,
        isDirty: false,
        lastSavedContent: '',
        lastUpdatedTime: null,
        mode: 'edit',
        saveStatus: 'idle',
        title: '',
      },
      false,
      n('closeDocument'),
    );
  },

  flushSave: () => {
    const save = createDebouncedSave(get);
    save.flush();
  },

  handleContentChange: () => {
    const { editor, lastSavedContent } = get();
    if (!editor) return;

    try {
      const markdownContent = (editor.getDocument('markdown') as unknown as string) || '';

      // Check if content actually changed
      const contentChanged = markdownContent !== lastSavedContent;

      set(
        { activeContent: markdownContent, isDirty: contentChanged },
        false,
        n('handleContentChange'),
      );

      // Only trigger auto-save if content actually changed
      if (contentChanged) {
        const save = createDebouncedSave(get);
        save();
      }
    } catch (error) {
      console.error('[DocumentEditor] Failed to update content:', error);
    }
  },

  onEditorInit: () => {
    const { editor, activeContent } = get();

    if (editor && activeContent) {
      // Set initial content when editor is ready
      editor.setDocument('markdown', activeContent);
    }
  },

  openDocument: ({ content, documentId, title, topicId }) => {
    const { editor } = get();

    set(
      {
        activeContent: content,
        activeDocumentId: documentId,
        activeTopicId: topicId,
        isDirty: false,
        lastSavedContent: content,
        mode: 'edit',
        saveStatus: 'idle',
        title,
      },
      false,
      n('openDocument', { documentId, topicId }),
    );

    // Set editor content if editor exists
    if (editor && content) {
      editor.setDocument('markdown', content);
    }
  },

  performSave: async () => {
    const { editor, activeDocumentId, title, activeTopicId, isDirty, updateDocument } = get();

    if (!editor || !activeDocumentId || !activeTopicId) return;

    // Skip save if no changes
    if (!isDirty) return;

    set({ saveStatus: 'saving' }, false, n('performSave:start'));

    try {
      const currentContent = (editor.getDocument('markdown') as unknown as string) || '';

      // Update document via notebook slice
      await updateDocument(
        {
          content: currentContent,
          id: activeDocumentId,
          title,
        },
        activeTopicId,
      );

      // Mark as clean and update save status
      set(
        {
          isDirty: false,
          lastSavedContent: currentContent,
          lastUpdatedTime: new Date(),
          saveStatus: 'saved',
        },
        false,
        n('performSave:success'),
      );
    } catch (error) {
      console.error('[DocumentEditor] Failed to save:', error);
      set({ saveStatus: 'idle' }, false, n('performSave:error'));
    }
  },

  setEditor: (editor) => {
    set({ editor }, false, n('setEditor'));
  },

  setEditorState: (editorState) => {
    set({ editorState }, false, n('setEditorState'));
  },

  setMode: (mode) => {
    set({ mode }, false, n('setMode', { mode }));
  },

  setTitle: (title) => {
    set({ isDirty: true, title }, false, n('setTitle'));
    const save = createDebouncedSave(get);
    save();
  },
});
