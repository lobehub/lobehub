import type {SendButtonProps, State} from './initialState';
import { initialSendButtonState  } from './initialState';

export const selectors = {
  sendButtonProps: (s: State): SendButtonProps => s.sendButtonProps || initialSendButtonState,
};
