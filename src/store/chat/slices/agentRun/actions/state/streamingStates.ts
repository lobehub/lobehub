import isEqual from 'fast-deep-equal';
import { produce } from 'immer';

import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';

/**
 * Manages loading states during streaming operations
 */

type Setter = StoreSetter<ChatStore>;
export const streamingStates = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new StreamingStatesActionImpl(set, get, _api);

export class StreamingStatesActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  internal_toggleSearchWorkflow = (loading: boolean, id?: string): void => {
    this.#get().internal_toggleLoadingArrays('searchWorkflowLoadingIds', loading, id);
  };

  internal_toggleToolCallingStreaming = (id: string, streaming: boolean[] | undefined): void => {
    const previous = this.#get().toolCallingStreamIds;
    const next = produce(previous, (draft) => {
      if (!!streaming) {
        draft[id] = streaming;
      } else {
        delete draft[id];
      }
    });

    if (isEqual(previous, next)) return;

    this.#set(
      { toolCallingStreamIds: next },

      false,
      `toggleToolCallingStreaming/${!!streaming ? 'start' : 'end'}`,
    );
  };
}

export type StreamingStatesAction = Pick<
  StreamingStatesActionImpl,
  keyof StreamingStatesActionImpl
>;
