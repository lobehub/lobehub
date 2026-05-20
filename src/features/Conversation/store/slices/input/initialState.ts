export interface InputState {
  /**
   * Measured height of the floating overlay that sits above the ChatInput
   * (TodoProgress + QueueTray). Used by the ChatList scroll container to
   * reserve matching bottom padding so the overlay doesn't cover the
   * latest messages.
   */
  chatInputOverlayHeight: number;

  /**
   * Editor instance (for ChatInput)
   */
  editor: any | null;

  /**
   * Current input message text
   */
  inputMessage: string;
}

export const inputInitialState: InputState = {
  chatInputOverlayHeight: 0,
  editor: null,
  inputMessage: '',
};
