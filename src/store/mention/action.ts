import { type StateCreator } from 'zustand/vanilla';

import { type MentionState, initialMentionState } from './initialState';

export interface MentionAction {
  addMentionedUser: (userId: string) => void;
  clearMentionedUsers: () => void;
  removeMentionedUser: (userId: string) => void;
  setMentionedUsers: (users: string[]) => void;
}

export const createMentionSlice: StateCreator<
  MentionState,
  [['zustand/devtools', never]],
  [],
  MentionAction
> = (set) => ({
  ...initialMentionState,

  addMentionedUser: (userId: string) => {
    set(
      (state) => ({
        mentionedUsers: state.mentionedUsers.includes(userId)
          ? state.mentionedUsers
          : [...state.mentionedUsers, userId],
      }),
      false,
      'addMentionedUser',
    );
  },

  clearMentionedUsers: () => {
    set({ mentionedUsers: [] }, false, 'clearMentionedUsers');
  },

  removeMentionedUser: (userId: string) => {
    set(
      (state) => ({
        mentionedUsers: state.mentionedUsers.filter((id) => id !== userId),
      }),
      false,
      'removeMentionedUser',
    );
  },

  setMentionedUsers: (users: string[]) => {
    set({ mentionedUsers: users }, false, 'setMentionedUsers');
  },
});
