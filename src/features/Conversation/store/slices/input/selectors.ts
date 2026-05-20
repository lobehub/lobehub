import { type State } from '../../initialState';

const editor = (s: State) => s.editor;
const inputMessage = (s: State) => s.inputMessage;
const hasInput = (s: State) => s.inputMessage.trim().length > 0;
const chatInputOverlayHeight = (s: State) => s.chatInputOverlayHeight;

export const inputSelectors = {
  chatInputOverlayHeight,
  editor,
  hasInput,
  inputMessage,
};
