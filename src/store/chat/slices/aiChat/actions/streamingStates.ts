import isEqual from 'fast-deep-equal';
import { produce } from 'immer';
import { type StateCreator } from 'zustand/vanilla';

import { type ChatStore } from '@/store/chat/store';

/**
 * Manages loading states during streaming operations
 */
export interface StreamingStatesAction {
  /**
   * Toggles the loading state for search workflow
   */
  internal_toggleSearchWorkflow: (loading: boolean, id?: string) => void;
  /**
   * Controls the streaming state of tool calling processes, updating the UI accordingly
   */
  internal_toggleToolCallingStreaming: (id: string, streaming: boolean[] | undefined) => void;
}

export const streamingStates: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  StreamingStatesAction
> = (set, get) => ({
  internal_toggleSearchWorkflow: (loading, id) => {
    return get().internal_toggleLoadingArrays('searchWorkflowLoadingIds', loading, id);
  },

  internal_toggleToolCallingStreaming: (id, streaming) => {
    const previous = get().toolCallingStreamIds;
    const next = produce(previous, (draft) => {
      if (!!streaming) {
        draft[id] = streaming;
      } else {
        delete draft[id];
      }
    });

    if (isEqual(previous, next)) return;

    set(
      { toolCallingStreamIds: next },

      false,
      `toggleToolCallingStreaming/${!!streaming ? 'start' : 'end'}`,
    );
  },
});
