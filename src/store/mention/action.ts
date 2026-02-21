import { type StoreSetter } from '@/store/types';

import { type MentionStore } from './store';

type Setter = StoreSetter<MentionStore>;
export const createMentionSlice = (set: Setter, get: () => MentionStore, _api?: unknown) =>
  new MentionActionImpl(set, get, _api);

export class MentionActionImpl {
  readonly #get: () => MentionStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => MentionStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  addMentionedUser = (userId: string): void => {
    this.#set(
      (state) => ({
        mentionedUsers: state.mentionedUsers.includes(userId)
          ? state.mentionedUsers
          : [...state.mentionedUsers, userId],
      }),
      false,
      'addMentionedUser',
    );
  };

  clearMentionedUsers = (): void => {
    this.#set({ mentionedUsers: [] }, false, 'clearMentionedUsers');
  };

  removeMentionedUser = (userId: string): void => {
    this.#set(
      (state) => ({
        mentionedUsers: state.mentionedUsers.filter((id) => id !== userId),
      }),
      false,
      'removeMentionedUser',
    );
  };

  setMentionedUsers = (users: string[]): void => {
    this.#set({ mentionedUsers: users }, false, 'setMentionedUsers');
  };
}

export type MentionAction = Pick<MentionActionImpl, keyof MentionActionImpl>;
