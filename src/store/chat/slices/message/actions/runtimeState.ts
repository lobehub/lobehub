import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';
import { type Action } from '@/utils/storeDebug';

import { type ChatStoreState } from '../../../initialState';
import { preventLeavingFn, toggleBooleanList } from '../../../utils';

/**
 * Runtime state management for message-related states
 * Handles loading states, active session tracking, etc.
 */

type Setter = StoreSetter<ChatStore>;
export const messageRuntimeState = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new MessageRuntimeStateActionImpl(set, get, _api);

export class MessageRuntimeStateActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  internal_toggleLoadingArrays = (
    key: keyof ChatStoreState,
    loading: boolean,
    id?: string,
    action?: Action,
  ): AbortController | undefined => {
    const abortControllerKey = `${key}AbortController`;
    if (loading) {
      window.addEventListener('beforeunload', preventLeavingFn);

      const abortController = new AbortController();
      this.#set(
        {
          [abortControllerKey]: abortController,
          [key]: toggleBooleanList(this.#get()[key] as string[], id!, loading),
        },
        false,
        action,
      );

      return abortController;
    } else {
      if (!id) {
        this.#set({ [abortControllerKey]: undefined, [key]: [] }, false, action);
      } else
        this.#set(
          {
            [abortControllerKey]: undefined,
            [key]: toggleBooleanList(this.#get()[key] as string[], id, loading),
          },
          false,
          action,
        );

      window.removeEventListener('beforeunload', preventLeavingFn);
    }
  };

  internal_toggleMessageLoading = (loading: boolean, id: string): void => {
    this.#set(
      {
        messageLoadingIds: toggleBooleanList(this.#get().messageLoadingIds, id, loading),
      },
      false,
      `internal_toggleMessageLoading/${loading ? 'start' : 'end'}`,
    );
  };
}

export type MessageRuntimeStateAction = Pick<
  MessageRuntimeStateActionImpl,
  keyof MessageRuntimeStateActionImpl
>;
