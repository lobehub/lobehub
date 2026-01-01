import { type SendButtonProps, type State, initialSendButtonState } from './initialState';

export const selectors = {
  sendButtonProps: (s: State): SendButtonProps => s.sendButtonProps || initialSendButtonState,
};
