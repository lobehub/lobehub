import { type State } from '../../initialState';

const editor = (s: State) => s.editor;
const inputMessage = (s: State) => s.inputMessage;
const hasInput = (s: State) => s.inputMessage.trim().length > 0;

export const inputSelectors = {
  editor,
  hasInput,
  inputMessage,
};
