import type { KeyboardEvent } from 'react';

/** Marks a topic row as a keyboard stop for arrow-key navigation. */
export const TOPIC_ROW_ATTR = 'data-topic-row';

/**
 * Bounds arrow-key navigation to one list, so the sidebar list and the
 * "all topics" drawer never hand focus to each other while both are open.
 * Every host that renders topic rows marks its list with it; a row outside
 * any marked list does not move focus.
 */
export const TOPIC_LIST_ROOT_ATTR = 'data-topic-list-root';

const isRendered = (element: HTMLElement) =>
  // Rows inside a collapsed group stay in the DOM; skip them. Environments
  // without `checkVisibility` (older Safari, test DOMs) keep every row.
  typeof element.checkVisibility === 'function' ? element.checkVisibility() : true;

const getSiblingRows = (row: HTMLElement) => {
  const root = row.closest(`[${TOPIC_LIST_ROOT_ATTR}]`);
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>(`[${TOPIC_ROW_ATTR}]`)].filter(isRendered);
};

/** Focuses a row and scrolls only as far as needed to show it. */
export const focusTopicRow = (row: HTMLElement | null | undefined) => {
  if (!row) return;
  row.focus({ preventScroll: true });
  row.scrollIntoView?.({ block: 'nearest' });
};

interface TopicRowKeyHandlers {
  /** Opens the topic. Only called for rows that are not links: a link already opens on Enter. */
  onOpen: () => void;
  /** Enters inline rename; omit when the row cannot be renamed. */
  onRename?: () => void;
}

/**
 * Keyboard model of a focused topic row, following VS Code / Windows:
 * Enter opens, F2 renames, ArrowUp / ArrowDown move between rows.
 */
export const handleTopicRowKeyDown = (
  event: KeyboardEvent<HTMLElement>,
  { onOpen, onRename }: TopicRowKeyHandlers,
) => {
  // Keys pressed on the row's own buttons (complete, archive, more) bubble here.
  if (event.target !== event.currentTarget) return;
  if (event.nativeEvent.isComposing) return;

  const row = event.currentTarget;
  const hasModifier = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;

  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowUp': {
      if (hasModifier) return;
      const rows = getSiblingRows(row);
      const index = rows.indexOf(row);
      const next = rows[event.key === 'ArrowDown' ? index + 1 : index - 1];
      // Prevent the list from scrolling even at either end of the list.
      event.preventDefault();
      if (index !== -1) focusTopicRow(next);
      return;
    }
    case 'F2': {
      if (hasModifier || !onRename) return;
      event.preventDefault();
      onRename();
      return;
    }
    case 'Enter': {
      // A link row activates on Enter natively (and keeps Cmd/Ctrl+Enter for a new tab).
      if (hasModifier || row instanceof HTMLAnchorElement) return;
      event.preventDefault();
      onOpen();
      return;
    }
  }
};
