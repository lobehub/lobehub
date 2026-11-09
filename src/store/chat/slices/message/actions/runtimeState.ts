import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';
import { type Action } from '@/utils/storeDebug';

import { type ChatStoreState } from '../../../initialState';
import { preventLeavingFn, toggleBooleanList } from '../../../utils';
import { persistFailedSendDrafts } from '../failedSendDraftStorage';
import type { FailedSendDraft } from '../initialState';

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

  retainFailedSendDraft = (contextKey: string, draft: FailedSendDraft): void => {
    const drafts = this.#get().failedSendDrafts;
    const nextDraft = { ...draft, createdAt: draft.createdAt ?? Date.now() };
    const next = {
      ...drafts,
      [contextKey]: [...(drafts[contextKey] ?? []), nextDraft],
    };
    this.#set({ failedSendDrafts: next }, false, 'message/retainFailedSendDraft');
    persistFailedSendDrafts(next);
  };

  removeFailedSendDraft = (contextKey: string, id: string): void => {
    const drafts = this.#get().failedSendDrafts;
    const remaining = drafts[contextKey]?.filter((draft) => draft.id !== id);
    const next = { ...drafts };
    if (remaining?.length) next[contextKey] = remaining;
    else delete next[contextKey];
    this.#set({ failedSendDrafts: next }, false, 'message/removeFailedSendDraft');
    persistFailedSendDrafts(next);
  };

  markFailedSendDraftRestored = (contextKey: string, id: string): void => {
    const drafts = this.#get().failedSendDrafts;
    const current = drafts[contextKey];
    if (!current) return;
    const next = {
      ...drafts,
      [contextKey]: current.map((draft) =>
        draft.id === id ? { ...draft, restored: true } : draft,
      ),
    };
    this.#set({ failedSendDrafts: next }, false, 'message/markFailedSendDraftRestored');
    persistFailedSendDrafts(next);
  };

  removeFailedSendDraftByMessage = (contextKey: string, message: string): void => {
    const drafts = this.#get().failedSendDrafts;
    const current = drafts[contextKey];
    if (!current) return;
    const index = current.findIndex((draft) => draft.message === message);
    if (index < 0) return;
    const remaining = current.filter((_, currentIndex) => currentIndex !== index);
    const next = { ...drafts };
    if (remaining.length) next[contextKey] = remaining;
    else delete next[contextKey];
    this.#set({ failedSendDrafts: next }, false, 'message/removeFailedSendDraftByMessage');
    persistFailedSendDrafts(next);
  };

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
}

export type MessageRuntimeStateAction = Pick<
  MessageRuntimeStateActionImpl,
  keyof MessageRuntimeStateActionImpl
>;
