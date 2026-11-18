import { type InputCompletionError, type SendButtonProps, type State } from './initialState';
import { initialSendButtonState } from './initialState';

export const selectors = {
  inputCompletionError: (s: State): InputCompletionError | undefined => s.inputCompletionError,
  inputCompletionErrorVisible: (s: State): InputCompletionError | undefined =>
    s.inputCompletionErrorDismissed ? undefined : s.inputCompletionError,
  inputCompletionPaused: (s: State): boolean => Boolean(s.inputCompletionError),
  /** A send from the draft on screen is waiting for its uploads to settle. */
  isSendQueuedForUploads: (s: State): boolean =>
    !!s.uploadQueuedSend && s.uploadQueuedSend.draftKey === s.draftKey,
  sendButtonProps: (s: State): SendButtonProps => s.sendButtonProps || initialSendButtonState,
};
