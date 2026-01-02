export interface InputState {
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
  editor: null,
  inputMessage: '',
};
