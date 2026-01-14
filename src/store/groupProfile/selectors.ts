import { type Store } from './action';
import { type SaveState } from './initialState';

const DEFAULT_SAVE_STATE: SaveState = { lastUpdatedTime: null, saveStatus: 'idle' };

const getSaveState = (tabId: string) => (s: Store) => s.saveStateMap[tabId] || DEFAULT_SAVE_STATE;

export const selectors = {
  chatPanelExpanded: (s: Store) => s.chatPanelExpanded,
  editor: (s: Store) => s.editor,
  editorState: (s: Store) => s.editorState,
  getSaveState,
};
