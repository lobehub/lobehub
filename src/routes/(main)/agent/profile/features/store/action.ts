import { EDITOR_DEBOUNCE_TIME, EDITOR_MAX_WAIT } from '@lobechat/const';
import { debounce } from 'es-toolkit/compat';
import { type StateCreator } from 'zustand';

import { type EditLockState, type State } from './initialState';
import { initialState } from './initialState';

type SaveConfigPayload = {
  editorData: Record<string, unknown>;
  systemRole: string;
};

export type UpdateConfigById = (agentId: string, payload: SaveConfigPayload) => Promise<void>;

interface PendingSave {
  agentId: string;
  payload: SaveConfigPayload;
  revision: number;
  updateConfigById: UpdateConfigById;
}

export interface Action {
  /**
   * Append content to streaming buffer (called during streaming)
   */
  appendStreamingContent: (chunk: string) => void;
  /**
   * Finalize streaming and save to config
   */
  finishStreaming: (agentId: string, updateConfigById: UpdateConfigById) => Promise<void>;
  flushSave: (agentId?: string) => Promise<void>;
  handleContentChange: (
    agentId: string,
    updateConfigById: UpdateConfigById,
    sourceEditor?: State['editor'],
  ) => void;
  /** Retry the latest failed Prompt autosave. */
  retryPromptSave: () => Promise<void>;
  /** Latch edit-intent so the lock driver acquires the lock on first real edit. */
  setHasEdited: (value: boolean) => void;
  /** Publish the latest edit-lock state from the always-mounted lock driver. */
  setLockState: (lockState: EditLockState) => void;
  /**
   * Start streaming mode - clears editor and prepares for streaming content
   */
  startStreaming: () => void;
}

export type Store = State & Action;

export const store: (initState?: Partial<State>) => StateCreator<Store> =
  (initState) => (set, get) => {
    // Keep saves from this editor ordered. Different agent-scoped providers may
    // save concurrently because AgentStore now owns independent abort signals
    // per agent.
    let saveQueue = Promise.resolve();
    let latestSaveRevision = 0;
    let failedSave: PendingSave | undefined;

    const createPendingSave = (pendingSave: Omit<PendingSave, 'revision'>): PendingSave => {
      const nextSave = { ...pendingSave, revision: ++latestSaveRevision };
      failedSave = undefined;
      set({ promptSaveStatus: 'saving' });
      return nextSave;
    };

    const enqueueSave = (pendingSave: PendingSave) => {
      const { agentId, payload, revision, updateConfigById } = pendingSave;
      saveQueue = saveQueue.then(async () => {
        try {
          await updateConfigById(agentId, payload);
          if (revision === latestSaveRevision) {
            failedSave = undefined;
            set({ promptLastUpdatedTime: new Date(), promptSaveStatus: 'saved' });
          }
        } catch (error) {
          console.error('[ProfileEditor] Failed to save:', error);
          if (revision === latestSaveRevision) {
            failedSave = pendingSave;
            set({ promptSaveStatus: 'failed' });
          }
        }
      });

      return saveQueue;
    };

    const createDebouncedSave = () =>
      debounce((pendingSave: PendingSave) => enqueueSave(pendingSave), EDITOR_DEBOUNCE_TIME, {
        leading: false,
        maxWait: EDITOR_MAX_WAIT,
        trailing: true,
      });

    // A dedicated debouncer per agent keeps pending drafts independent. In
    // particular, typing in agent B must never replace agent A's trailing save.
    const debouncedSaveMap = new Map<string, ReturnType<typeof createDebouncedSave>>();

    const getDebouncedSave = (agentId: string) => {
      const existing = debouncedSaveMap.get(agentId);
      if (existing) return existing;

      const debouncedSave = createDebouncedSave();
      debouncedSaveMap.set(agentId, debouncedSave);
      return debouncedSave;
    };

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

      finishStreaming: async (agentId, updateConfigById) => {
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
            editorData = editor.getDocument('json') as unknown as Record<string, unknown>;
          } catch {
            // Use streaming content if editor read fails
          }
        }

        // Save to config
        try {
          await enqueueSave(
            createPendingSave({
              agentId,
              payload: {
                editorData: structuredClone(editorData || {}),
                systemRole: finalContent,
              },
              updateConfigById,
            }),
          );
        } catch (error) {
          console.error('[ProfileEditor] Failed to save streaming content:', error);
        }

        // Reset streaming state
        set({
          streamingContent: undefined,
          streamingInProgress: false,
        });
      },

      flushSave: async (agentId) => {
        const debouncedSaves = agentId
          ? [debouncedSaveMap.get(agentId)]
          : [...debouncedSaveMap.values()];

        await Promise.all(debouncedSaves.map((debouncedSave) => debouncedSave?.flush()));
        await saveQueue;
      },

      handleContentChange: (agentId, updateConfigById, sourceEditor) => {
        const editor = sourceEditor ?? get().editor;
        if (!agentId || !editor) return;

        try {
          const markdownContent = (editor.getDocument('markdown') as unknown as string) || '';
          const jsonContent = editor.getDocument('json') as unknown as Record<string, unknown>;

          getDebouncedSave(agentId)(
            createPendingSave({
              agentId,
              payload: {
                editorData: structuredClone(jsonContent || {}),
                systemRole: markdownContent || '',
              },
              updateConfigById,
            }),
          );
        } catch (error) {
          console.error('[ProfileEditor] Failed to read editor content:', error);
        }
      },
      retryPromptSave: async () => {
        const pendingSave = failedSave;
        if (!pendingSave) return;

        failedSave = undefined;
        set({ promptSaveStatus: 'saving' });
        await enqueueSave(pendingSave);
      },
      setHasEdited: (value) => {
        if (get().hasEdited !== value) set({ hasEdited: value });
      },

      setLockState: (lockState) => {
        const prev = get().lockState;
        if (
          prev.holderId !== lockState.holderId ||
          prev.lockedByOther !== lockState.lockedByOther ||
          prev.pending !== lockState.pending
        ) {
          set({ lockState });
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
