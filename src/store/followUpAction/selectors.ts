import { type FollowUpActionState } from './initialState';

const chipsForMessage = (messageId: string) => (s: FollowUpActionState) =>
  s.messageId === messageId && s.status === 'ready' ? s.chips : [];

const isReady = (messageId: string) => (s: FollowUpActionState) =>
  s.messageId === messageId && s.status === 'ready' && s.chips.length > 0;

export const followUpActionSelectors = {
  chipsForMessage,
  isReady,
};
