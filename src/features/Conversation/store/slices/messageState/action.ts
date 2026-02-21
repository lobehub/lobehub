import { produce } from 'immer';
import { type StateCreator } from 'zustand';

import { type State } from '../../initialState';

export interface MessageEditingAction {
  /**
   * Toggle message editing state
   */
  toggleMessageEditing: (id: string, editing: boolean) => void;
}

/**
 * Helper function to toggle an item in a boolean list
 */
const toggleBooleanList = (ids: string[], id: string, value: boolean) => {
  return produce(ids, (draft) => {
    if (value) {
      if (!draft.includes(id)) draft.push(id);
    } else {
      const index = draft.indexOf(id);
      if (index >= 0) draft.splice(index, 1);
    }
  });
};

export const messageEditingSlice: StateCreator<
  State,
  [['zustand/devtools', never]],
  [],
  MessageEditingAction
> = (set, get) => ({
  toggleMessageEditing: (id, editing) => {
    set(
      { messageEditingIds: toggleBooleanList(get().messageEditingIds, id, editing) },
      false,
      'toggleMessageEditing',
    );
  },
});
