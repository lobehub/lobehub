import { debounce } from 'es-toolkit/compat';
import { type StateCreator } from 'zustand';

import { EDITOR_DEBOUNCE_TIME, EDITOR_MAX_WAIT } from '@/const/index';

import { type SaveState, type SaveStatus, type State, initialState } from './initialState';

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
  /**
   * Set content from agent builder - triggers editor to update
   * @param entityId - groupId for group editor, agentId for member editor
   */
  setAgentBuilderContent: (entityId: string, content: string) => void;
  setChatPanelExpanded: (expanded: boolean | ((prev: boolean) => boolean)) => void;
  updateSaveStatus: (tabId: string, status: SaveStatus) => void;
}

export type Store = State & Action;

// Store the latest saveCallback and tabId references to avoid stale closures
let saveCallbackRef: ((payload: SaveContentPayload) => Promise<void>) | null = null;
let currentTabIdRef: string | null = null;

const DEFAULT_SAVE_STATE: SaveState = { lastUpdatedTime: null, saveStatus: 'idle' };

export const store: StateCreator<Store> = (set, get) => {
  const updateSaveStatusInternal = (tabId: string, status: SaveStatus) => {
    const { saveStateMap } = get();
    const currentState = saveStateMap[tabId] || DEFAULT_SAVE_STATE;
    set({
      saveStateMap: {
        ...saveStateMap,
        [tabId]: {
          ...currentState,
          lastUpdatedTime: status === 'saved' ? new Date() : currentState.lastUpdatedTime,
          saveStatus: status,
        },
      },
    });
  };

  // Create debounced save that uses the latest callback reference
  const debouncedSave = debounce(
    async (payload: SaveContentPayload) => {
      const tabId = currentTabIdRef;
      if (!tabId) return;

      try {
        if (saveCallbackRef) {
          await saveCallbackRef(payload);
          updateSaveStatusInternal(tabId, 'saved');
        }
      } catch (error) {
        console.error('[ProfileEditor] Failed to save:', error);
        updateSaveStatusInternal(tabId, 'idle');
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
      const { activeTabId, editor, streamingContent } = get();
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

      updateSaveStatusInternal(activeTabId, 'saving');

      try {
        await saveCallback({
          content: finalContent,
          editorData: structuredClone(editorData || {}),
        });
        updateSaveStatusInternal(activeTabId, 'saved');
      } catch (error) {
        console.error('[ProfileEditor] Failed to save streaming content:', error);
        updateSaveStatusInternal(activeTabId, 'idle');
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
      const { activeTabId, editor } = get();
      if (!editor) return;

      // Always update refs to use the latest callback and tabId
      saveCallbackRef = saveCallback;
      currentTabIdRef = activeTabId;

      // Set saving status immediately when user makes changes
      updateSaveStatusInternal(activeTabId, 'saving');

      try {
        const markdownContent = (editor.getDocument('markdown') as unknown as string) || '';
        const jsonContent = editor.getDocument('json') as unknown as Record<string, any>;

        debouncedSave({
          content: markdownContent || '',
          editorData: structuredClone(jsonContent || {}),
        });
      } catch (error) {
        console.error('[ProfileEditor] Failed to read editor content:', error);
        updateSaveStatusInternal(activeTabId, 'idle');
      }
    },

    setActiveTabId: (tabId) => {
      set({ activeTabId: tabId });
    },

    setAgentBuilderContent: (entityId, content) => {
      set({
        agentBuilderContentUpdate: {
          content,
          entityId,
          timestamp: Date.now(),
        },
      });
    },

    setChatPanelExpanded: (expanded) => {
      if (typeof expanded === 'function') {
        set((state) => ({ chatPanelExpanded: expanded(state.chatPanelExpanded) }));
      } else {
        set({ chatPanelExpanded: expanded });
      }
    },

    updateSaveStatus: (tabId, status) => {
      updateSaveStatusInternal(tabId, status);
    },
  };
};
