import type {MentionState} from './initialState';

const mentionedUsers = (s: MentionState) => s.mentionedUsers;
const hasMentionedUsers = (s: MentionState) => s.mentionedUsers.length > 0;

export const mentionSelectors = {
  hasMentionedUsers,
  mentionedUsers,
};
