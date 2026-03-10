import { EDITOR_DEBOUNCE_TIME, EDITOR_MAX_WAIT } from '@lobechat/const';
import { debounce } from 'es-toolkit/compat';
import { type StateCreator } from 'zustand';

import { type State } from './initialState';
import { initialState } from './initialState';

type SaveConfigPayload = {
  editorData: Record<string, any>;
  systemRole: string;
};

export interface Action {
  /**
   * Append content to streaming buffer (called during streaming)
   */
  appendStreamingContent: (chunk: string) => void;
  /**
   * Finalize streaming and save to config
   */
  finishStreaming: (updateConfig: (payload: SaveConfigPayload) => Promise<void>) => Promise<void>;
  flushSave: () => void;
  handleContentChange: (updateConfig: (payload: SaveConfigPayload) => Promise<void>) => void;
  /**
   * Start streaming mode - clears editor and prepares for streaming content
   */
  startStreaming: () => void;
}

export type Store = State & Action;

// Store the latest updateConfig reference to avoid stale closures
let updateConfigRef: ((payload: SaveConfigPayload) => Promise<void>) | null = null;

export const store: (initState?: Partial<State>) => StateCreator<Store> =
  (initState) => (set, get) => {
    // Create debounced save that uses the latest callback reference
    const debouncedSave = debounce(
      async (payload: SaveConfigPayload) => {
        try {
          if (updateConfigRef) {
            await updateConfigRef(payload);
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
      ...initState,

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

      finishStreaming: async (updateConfig) => {
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
          await updateConfig({
            editorData: structuredClone(editorData || {}),
            systemRole: finalContent,
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

      handleContentChange: (updateConfig) => {
        const { editor } = get();
        if (!editor) return;

        // Always update ref to use the latest callback
        updateConfigRef = updateConfig;

        try {
          const markdownContent = (editor.getDocument('markdown') as unknown as string) || '';
          const jsonContent = editor.getDocument('json') as unknown as Record<string, any>;

          debouncedSave({
            editorData: structuredClone(jsonContent || {}),
            systemRole: markdownContent || '',
          });
        } catch (error) {
          console.error('[ProfileEditor] Failed to read editor content:', error);
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
