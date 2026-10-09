import { debounce } from 'es-toolkit/compat';
import { type StateCreator } from 'zustand';

import { EDITOR_DEBOUNCE_TIME, EDITOR_MAX_WAIT } from '@/const/index';
import { createReplicaSlice, createReplicaState, recordLens } from '@/libs/replica';
import { type StoreSetter } from '@/store/types';
import { flattenActions } from '@/store/utils/flattenActions';

import { type SaveState, type SaveStatus, type State } from './initialState';
import { initialState } from './initialState';
import { groupProfileSaveResource } from './projection';

type SaveContentPayload = {
  content: string;
  editorData: Record<string, any>;
};

export type Action = Pick<ActionImpl, keyof ActionImpl>;
export type Store = State & Action;

// Store the latest saveCallback and tabId references to avoid stale closures
let saveCallbackRef: ((payload: SaveContentPayload) => Promise<void>) | null = null;
let currentTabIdRef: string | null = null;

const DEFAULT_SAVE_STATE: SaveState = { lastUpdatedTime: null, saveStatus: 'idle' };

type Setter = StoreSetter<Store>;
export class ActionImpl {
  #debouncedSave: ReturnType<typeof debounce>;
  #get: () => Store;
  /** Local-first replica of the per-tab save status (`saveStateMap` is its view). */
  #saveStates;
  #set: Setter;

  constructor(set: Setter, get: () => Store, _api?: unknown) {
    // keep signature aligned with StateCreator params: (set, get, api)
    void _api;
    this.#get = get;
    this.#set = set;

    this.#saveStates = createReplicaSlice(groupProfileSaveResource, {
      actionPrefix: 'groupProfile/save',
      get,
      set,
      stateKey: 'saveStateMapReplica',
      view: recordLens<Store, SaveState>('saveStateMap'),
    });

    this.#debouncedSave = debounce(
      async (payload: SaveContentPayload) => {
        const tabId = currentTabIdRef;
        if (!tabId) return;

        try {
          if (saveCallbackRef) {
            await saveCallbackRef(payload);
            this.#updateSaveStatusInternal(tabId, 'saved');
          }
        } catch (error) {
          console.error('[ProfileEditor] Failed to save:', error);
          this.#updateSaveStatusInternal(tabId, 'idle');
        }
      },
      EDITOR_DEBOUNCE_TIME,
      { leading: false, maxWait: EDITOR_MAX_WAIT, trailing: true },
    );
  }

  #updateSaveStatusInternal = (tabId: string, status: SaveStatus) => {
    // Write through the replica engine so the view and its bookkeeping slot
    // (`saveStateMapReplica`) always move together.
    this.#saveStates.update(tabId, (current) => {
      const previous = current ?? DEFAULT_SAVE_STATE;
      return {
        ...previous,
        lastUpdatedTime: status === 'saved' ? new Date() : previous.lastUpdatedTime,
        saveStatus: status,
      };
    });
  };

  appendStreamingContent = (chunk: string): void => {
    const currentContent = this.#get().streamingContent || '';
    const newContent = currentContent + chunk;
    this.#set({ streamingContent: newContent });

    const { editor } = this.#get();
    if (editor) {
      try {
        editor.setDocument('markdown', newContent);
      } catch {
        // Ignore errors during streaming updates
      }
    }
  };

  /**
   * Drop everything the profile page put in the store when it unmounts. The
   * view (`saveStateMap`) and its replica bookkeeping are cleared together, so
   * a later visit never sees a stale entry.
   */
  clearProfileState = (): void => {
    this.#set(
      {
        activeTabId: 'group',
        editor: undefined,
        editorState: undefined,
        saveStateMap: {},
        saveStateMapReplica: createReplicaState(),
      },
      false,
      'clearProfileState',
    );
  };

  finishStreaming = async (
    saveCallback: (payload: SaveContentPayload) => Promise<void>,
  ): Promise<void> => {
    const { activeTabId, editor, streamingContent } = this.#get();
    if (!streamingContent) {
      this.#set({ streamingInProgress: false });
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

    this.#updateSaveStatusInternal(activeTabId, 'saving');

    try {
      await saveCallback({
        content: finalContent,
        editorData: structuredClone(editorData || {}),
      });
      this.#updateSaveStatusInternal(activeTabId, 'saved');
    } catch (error) {
      console.error('[ProfileEditor] Failed to save streaming content:', error);
      this.#updateSaveStatusInternal(activeTabId, 'idle');
    }

    this.#set({
      streamingContent: undefined,
      streamingInProgress: false,
    });
  };

  flushSave = (): void => {
    this.#debouncedSave.flush();
  };

  handleContentChange = (saveCallback: (payload: SaveContentPayload) => Promise<void>): void => {
    const { activeTabId, editor } = this.#get();
    if (!editor) return;

    // Always update refs to use the latest callback and tabId
    saveCallbackRef = saveCallback;
    currentTabIdRef = activeTabId;

    // Set saving status immediately when user makes changes
    this.#updateSaveStatusInternal(activeTabId, 'saving');

    try {
      const markdownContent = (editor.getDocument('markdown') as unknown as string) || '';
      const jsonContent = editor.getDocument('json') as unknown as Record<string, any>;

      this.#debouncedSave({
        content: markdownContent || '',
        editorData: structuredClone(jsonContent || {}),
      });
    } catch (error) {
      console.error('[ProfileEditor] Failed to read editor content:', error);
      this.#updateSaveStatusInternal(activeTabId, 'idle');
    }
  };

  setActiveTabId = (tabId: string): void => {
    this.#set({ activeTabId: tabId });
  };

  setAgentBuilderContent = (entityId: string, content: string): void => {
    this.#set({
      agentBuilderContentUpdate: {
        content,
        entityId,
        timestamp: Date.now(),
      },
    });
  };

  setChatPanelExpanded = (expanded: boolean | ((prev: boolean) => boolean)): void => {
    if (typeof expanded === 'function') {
      this.#set((state) => ({ chatPanelExpanded: expanded(state.chatPanelExpanded) }));
    } else {
      this.#set({ chatPanelExpanded: expanded });
    }
  };

  updateSaveStatus = (tabId: string, status: SaveStatus): void => {
    this.#updateSaveStatusInternal(tabId, status);
  };
}

export const store: StateCreator<Store> = (...parameters: Parameters<StateCreator<Store>>) => ({
  ...initialState,
  ...flattenActions<Action>([new ActionImpl(...parameters)]),
});
