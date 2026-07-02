import { produce } from 'immer';
import { type StateCreator } from 'zustand';

import { isSelectableRole } from '../../../MessageForward/selectableRoles';
import { type State } from '../../initialState';

export interface MessageEditingAction {
  /**
   * Enter multi-select mode. When `initialId` is provided that message starts
   * selected and anchors the "select to here" range action.
   */
  enterSelectionMode: (initialId?: string) => void;
  /**
   * Leave multi-select mode and drop every selected id.
   */
  exitSelectionMode: () => void;
  /**
   * Shift-click range select: add every selectable message between the current
   * anchor and `id` (inclusive) to the selection, then move the anchor to `id`.
   * Falls back to a plain toggle when there is no anchor yet.
   */
  selectRange: (id: string) => void;
  /**
   * Select every selectable message from the top of the conversation down to
   * `targetId` (inclusive) — the "here" marker line. Falls back to the anchor
   * when no target is given. Mirrors WeChat's "选择到这里".
   */
  selectToHere: (targetId?: string) => void;
  /**
   * Toggle message editing state
   */
  toggleMessageEditing: (id: string, editing: boolean) => void;
  /**
   * Toggle whether a message is checked in multi-select mode.
   */
  toggleMessageSelected: (id: string, selected?: boolean) => void;
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
  enterSelectionMode: (initialId) => {
    set(
      {
        selectedMessageIds: initialId ? [initialId] : [],
        selectionAnchorId: initialId,
        selectionMode: true,
      },
      false,
      'enterSelectionMode',
    );
  },
  exitSelectionMode: () => {
    set(
      { selectedMessageIds: [], selectionAnchorId: undefined, selectionMode: false },
      false,
      'exitSelectionMode',
    );
  },
  selectRange: (id) => {
    const { displayMessages, selectionAnchorId, selectedMessageIds } = get();
    const anchorIndex = selectionAnchorId
      ? displayMessages.findIndex((m) => m.id === selectionAnchorId)
      : -1;
    const targetIndex = displayMessages.findIndex((m) => m.id === id);
    // No anchor yet (or target missing): behave like a plain select-on.
    if (targetIndex < 0 || anchorIndex < 0) {
      set(
        {
          selectedMessageIds: toggleBooleanList(selectedMessageIds, id, true),
          selectionAnchorId: id,
        },
        false,
        'selectRange',
      );
      return;
    }

    const [lo, hi] =
      anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
    const rangeIds = displayMessages
      .slice(lo, hi + 1)
      .filter((m) => isSelectableRole(m.role))
      .map((m) => m.id);

    const next = new Set(selectedMessageIds);
    for (const rangeId of rangeIds) next.add(rangeId);

    set({ selectedMessageIds: [...next], selectionAnchorId: id }, false, 'selectRange');
  },
  selectToHere: (targetId) => {
    const { displayMessages, selectionAnchorId } = get();
    const anchorId = targetId ?? selectionAnchorId;
    const anchorIndex = anchorId
      ? displayMessages.findIndex((m) => m.id === anchorId)
      : displayMessages.length - 1;
    if (anchorIndex < 0) return;

    const ids = displayMessages
      .slice(0, anchorIndex + 1)
      .filter((m) => isSelectableRole(m.role))
      .map((m) => m.id);

    set({ selectedMessageIds: ids }, false, 'selectToHere');
  },
  toggleMessageEditing: (id, editing) => {
    set(
      { messageEditingIds: toggleBooleanList(get().messageEditingIds, id, editing) },
      false,
      'toggleMessageEditing',
    );
  },
  toggleMessageSelected: (id, selected) => {
    const current = get().selectedMessageIds;
    const next = selected ?? !current.includes(id);
    set(
      // Move the anchor to the last interacted message so Shift-range and
      // "select to here" both reference the user's current focus.
      { selectedMessageIds: toggleBooleanList(current, id, next), selectionAnchorId: id },
      false,
      'toggleMessageSelected',
    );
  },
});
