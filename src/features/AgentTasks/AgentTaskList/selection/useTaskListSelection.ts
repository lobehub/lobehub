import { type RefObject, useCallback, useEffect, useRef } from 'react';

import { useTaskSelectionStore } from './store';
import { isEditableTarget } from './taskSelectionModel';
import { useTaskBatchUndo } from './undo/useTaskBatchUndo';
import { useSelectionScope } from './useSelectionScope';

interface UseTaskListSelectionOptions {
  /** The list's root element: ⌘A / Esc act only when focus is on it or on nothing. */
  listRef: RefObject<HTMLElement | null>;
  /**
   * Identity of the collection the rows belong to (tab, sub-scope, page,
   * owner). The selection is dropped whenever it changes.
   */
  scope: string;
  /** Selectable ids in display order, top to bottom. */
  selectableIds: readonly string[];
}

/**
 * Everything a task list owes the shared selection store: prune the selection
 * to the rows on screen, drop it when the list changes identity, and handle
 * ⌘/Ctrl+A (select all), ⌘/Ctrl+Z (undo the last batch action) and Esc (clear).
 *
 * @returns the stable getter rows pass to `SelectableTaskRow` for Shift+click ranges
 */
export const useTaskListSelection = ({
  listRef,
  scope,
  selectableIds,
}: UseTaskListSelectionOptions) => {
  const selectableIdsRef = useRef(selectableIds);
  selectableIdsRef.current = selectableIds;
  const getSelectionOrder = useCallback(() => selectableIdsRef.current, []);

  // A selection never outlives the rows it names: prune on every list change,
  // and drop it when this list (or its collection) goes away.
  useEffect(() => {
    useTaskSelectionStore.getState().prune(new Set(selectableIds));
  }, [selectableIds]);
  useSelectionScope(scope);

  const { undoLast } = useTaskBatchUndo();
  const undoLastRef = useRef(undoLast);
  useEffect(() => {
    undoLastRef.current = undoLast;
  }, [undoLast]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return;
      // Only when nothing else holds focus, or focus is on the list itself:
      // ⌘A over a side panel's text keeps selecting that text, and Esc inside
      // a drawer or popover stays theirs.
      const target = event.target as Node | null;
      const onList = !!target && !!listRef.current?.contains(target);
      if (target !== document.body && !onList) return;
      const selection = useTaskSelectionStore.getState();
      if (
        event.key.toLowerCase() === 'a' &&
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey
      ) {
        if (selectableIdsRef.current.length === 0) return;
        event.preventDefault();
        selection.selectAll(selectableIdsRef.current);
        return;
      }
      // ⌘/Ctrl+Z: undo the most recent batch action (session-wide stack, so it
      // still works after its toast is gone). Shift+⌘Z is left to the page.
      if (
        event.key.toLowerCase() === 'z' &&
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey
      ) {
        if (undoLastRef.current()) event.preventDefault();
        return;
      }
      if (event.key === 'Escape' && selection.selectedIds.length > 0 && !selection.progress) {
        event.preventDefault();
        selection.clear();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [listRef]);

  return { getSelectionOrder };
};
