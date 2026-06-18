import { type InputCompletionError, type SendButtonProps, type State } from './initialState';
import { initialSendButtonState } from './initialState';

export const selectors = {
  inputCompletionError: (s: State): InputCompletionError | undefined => s.inputCompletionError,
  inputCompletionErrorVisible: (s: State): InputCompletionError | undefined =>
    s.inputCompletionErrorDismissed ? undefined : s.inputCompletionError,
  inputCompletionPaused: (s: State): boolean => Boolean(s.inputCompletionError),
  sendButtonProps: (s: State): SendButtonProps => s.sendButtonProps || initialSendButtonState,
};
