import { EDITOR_DEBOUNCE_TIME, EDITOR_MAX_WAIT } from '@/const/index';
import { debounce } from 'es-toolkit/compat';
import { type StateCreator } from 'zustand';

import { type State, initialState } from './initialState';

type SaveContentPayload = {
  content: string;
  editorData: Record<string, any>;
};

export interface Action {
  /**
   * Append content to streaming buffer (called during streaming)
   */
  appendStreamingContent: (chunk: string) => void;
  /**
   * Finalize streaming and save to config
   */
  finishStreaming: (updateContent: (payload: SaveContentPayload) => Promise<void>) => Promise<void>;
  flushSave: () => void;
  handleContentChange: (updateContent: (payload: SaveContentPayload) => Promise<void>) => void;
  /**
   * Set active tab ID
   */
  setActiveTabId: (tabId: string) => void;
  setChatPanelExpanded: (expanded: boolean | ((prev: boolean) => boolean)) => void;
  /**
   * Start streaming mode - clears editor and prepares for streaming content
   */
  startStreaming: () => void;
}

export type Store = State & Action;

// Create debounced save function outside of store for reuse
const createDebouncedSave = (
  get: () => Store,
  updateContent: (payload: SaveContentPayload) => Promise<void>,
) =>
  debounce(
    async (payload: SaveContentPayload) => {
      try {
        await updateContent(payload);
      } catch (error) {
        console.error('[ProfileEditor] Failed to save:', error);
      }
    },
    EDITOR_DEBOUNCE_TIME,
    { leading: false, maxWait: EDITOR_MAX_WAIT, trailing: true },
  );

export const store: StateCreator<Store> = (set, get) => {
  let debouncedSave: ReturnType<typeof createDebouncedSave> | null = null;

  return {
    ...initialState,

      appendStreamingContent: (chunk) => {
        const currentContent = get().streamingContent || '';
        const newContent = currentContent + chunk;
        set({ streamingContent: newContent });

        // Update editor with streaming content
        const { editor } = get();
        if (editor) {
          try {
            editor.setDocument('markdown', newContent);
          } catch {
            // Ignore errors during streaming updates
          }
        }
      },

      finishStreaming: async (updateContent) => {
        const { editor, streamingContent } = get();
        if (!streamingContent) {
          set({ streamingInProgress: false });
          return;
        }

        // Get the final content from editor
        let finalContent = streamingContent;
        let editorData = {};

        if (editor) {
          try {
            finalContent =
              (editor.getDocument('markdown') as unknown as string) || streamingContent;
            editorData = editor.getDocument('json') as unknown as Record<string, any>;
          } catch {
            // Use streaming content if editor read fails
          }
        }

        // Save to config
        try {
          await updateContent({
            content: finalContent,
            editorData: structuredClone(editorData || {}),
          });
        } catch (error) {
          console.error('[ProfileEditor] Failed to save streaming content:', error);
        }

        // Reset streaming state
        set({
          streamingContent: undefined,
          streamingInProgress: false,
        });
      },

      flushSave: () => {
        debouncedSave?.flush();
      },

      handleContentChange: (updateContent) => {
        const { editor } = get();
        if (!editor) return;

        // Create debounced save on first use
        if (!debouncedSave) {
          debouncedSave = createDebouncedSave(get, updateContent);
        }

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

      startStreaming: () => {
        const { editor } = get();

        // Clear editor content and prepare for streaming
        if (editor) {
          try {
            editor.setDocument('markdown', '');
          } catch {
            // Ignore errors
          }
        }

        set({
          streamingContent: '',
          streamingInProgress: true,
        });
      },
    };
  };
