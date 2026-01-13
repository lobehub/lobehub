import { debounce } from 'es-toolkit/compat';
import { type StateCreator } from 'zustand';

import { EDITOR_DEBOUNCE_TIME, EDITOR_MAX_WAIT } from '@/const/index';

import { type State, initialState } from './initialState';

type SaveContentPayload = {
  content: string;
  editorData: Record<string, any>;
};

export interface Action {
  appendStreamingContent: (chunk: string) => void;
  finishStreaming: (saveCallback: (payload: SaveContentPayload) => Promise<void>) => Promise<void>;
  flushSave: () => void;
  handleContentChange: (saveCallback: (payload: SaveContentPayload) => Promise<void>) => void;
  setActiveTabId: (tabId: string) => void;
  setChatPanelExpanded: (expanded: boolean | ((prev: boolean) => boolean)) => void;
}

export type Store = State & Action;

// Store the latest saveCallback reference to avoid stale closures
let saveCallbackRef: ((payload: SaveContentPayload) => Promise<void>) | null = null;

export const store: StateCreator<Store> = (set, get) => {
  // Create debounced save that uses the latest callback reference
  const debouncedSave = debounce(
    async (payload: SaveContentPayload) => {
      try {
        if (saveCallbackRef) {
          await saveCallbackRef(payload);
        }
      } catch (error) {
        console.error('[ProfileEditor] Failed to save:', error);
      }
    },
    EDITOR_DEBOUNCE_TIME,
    { leading: false, maxWait: EDITOR_MAX_WAIT, trailing: true },
  );

  return {
    ...initialState,

    appendStreamingContent: (chunk) => {
      const currentContent = get().streamingContent || '';
      const newContent = currentContent + chunk;
      set({ streamingContent: newContent });

      const { editor } = get();
      if (editor) {
        try {
          editor.setDocument('markdown', newContent);
        } catch {
          // Ignore errors during streaming updates
        }
      }
    },

    finishStreaming: async (saveCallback) => {
      const { editor, streamingContent } = get();
      if (!streamingContent) {
        set({ streamingInProgress: false });
        return;
      }

      let finalContent = streamingContent;
      let editorData = {};

      if (editor) {
        try {
          finalContent = (editor.getDocument('markdown') as unknown as string) || streamingContent;
          editorData = editor.getDocument('json') as unknown as Record<string, any>;
        } catch {
          // Use streaming content if editor read fails
        }
      }

      try {
        await saveCallback({
          content: finalContent,
          editorData: structuredClone(editorData || {}),
        });
      } catch (error) {
        console.error('[ProfileEditor] Failed to save streaming content:', error);
      }

      set({
        streamingContent: undefined,
        streamingInProgress: false,
      });
    },

    flushSave: () => {
      debouncedSave.flush();
    },

    handleContentChange: (saveCallback) => {
      const { editor } = get();
      if (!editor) return;

      // Always update ref to use the latest callback
      saveCallbackRef = saveCallback;

      try {
        const markdownContent = (editor.getDocument('markdown') as unknown as string) || '';
        const jsonContent = editor.getDocument('json') as unknown as Record<string, any>;

        debouncedSave({
          content: markdownContent || '',
          editorData: structuredClone(jsonContent || {}),
        });
      } catch (error) {
        console.error('[ProfileEditor] Failed to read editor content:', error);
      }
    },

    setActiveTabId: (tabId) => {
      set({ activeTabId: tabId });
    },

    setChatPanelExpanded: (expanded) => {
      if (typeof expanded === 'function') {
        set((state) => ({ chatPanelExpanded: expanded(state.chatPanelExpanded) }));
      } else {
        set({ chatPanelExpanded: expanded });
      }
    },
  };
};
