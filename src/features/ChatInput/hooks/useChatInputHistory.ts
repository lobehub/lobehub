import type { IEditor } from '@lobehub/editor';
import type { RefObject } from 'react';
import { useCallback, useRef, useState } from 'react';

import type { ChatInputHistoryEntry, ChatInputHistoryScope } from '../inputHistoryStorage';
import { getInputHistory } from '../inputHistoryStorage';

export interface ChatInputHistoryPopupState {
  /** Index into `entries`; 0 is the most recent prompt. */
  activeIndex: number;
  entries: ChatInputHistoryEntry[];
  open: boolean;
}

const CLOSED_POPUP: ChatInputHistoryPopupState = { activeIndex: 0, entries: [], open: false };

export const shouldIgnoreInputHistoryKeyDown = (
  event: KeyboardEvent,
  isComposing: boolean,
): boolean =>
  event.defaultPrevented ||
  event.isComposing ||
  isComposing ||
  event.altKey ||
  event.ctrlKey ||
  event.metaKey ||
  event.shiftKey;

const focusEditorAfterHistoryNavigation = (editor: IEditor) => {
  // setDocument can make the Lexical root lose focus; restore it so the user can
  // keep editing the recalled prompt immediately.
  requestAnimationFrame(() => {
    editor.focus();
  });
};

const restoreHistoryEntryDocument = (editor: IEditor, entry: ChatInputHistoryEntry) => {
  if (!entry.json) {
    editor.setDocument('markdown', entry.markdown, { keepHistory: true });
    return;
  }

  try {
    editor.setDocument('json', entry.json, { keepHistory: true });
  } catch {
    // Example: a rich-input list/code node can fail after rich input is disabled;
    // markdown stays portable across different chat input plugin sets.
    editor.setDocument('markdown', entry.markdown, { keepHistory: true });
  }
};

interface UseChatInputHistoryOptions {
  editor?: IEditor;
  enabled: boolean;
  getMarkdownContent: () => string;
  isComposingRef: RefObject<boolean>;
  scope?: ChatInputHistoryScope;
}

export const useChatInputHistory = ({
  editor,
  enabled,
  getMarkdownContent,
  isComposingRef,
  scope,
}: UseChatInputHistoryOptions) => {
  const [popup, setPopup] = useState<ChatInputHistoryPopupState>(CLOSED_POPUP);
  // Mirror of `popup` so the editor keydown closure always reads the latest
  // state synchronously, even between React renders.
  const popupRef = useRef(popup);

  const applyPopup = useCallback((next: ChatInputHistoryPopupState) => {
    popupRef.current = next;
    setPopup(next);
  }, []);

  const close = useCallback(() => {
    if (!popupRef.current.open) return;
    applyPopup(CLOSED_POPUP);
  }, [applyPopup]);

  const setActiveIndex = useCallback(
    (index: number) => {
      const prev = popupRef.current;
      if (!prev.open) return;
      const clamped = Math.max(0, Math.min(index, prev.entries.length - 1));
      if (clamped === prev.activeIndex) return;
      applyPopup({ ...prev, activeIndex: clamped });
    },
    [applyPopup],
  );

  const confirm = useCallback(
    (index?: number) => {
      const { activeIndex, entries, open } = popupRef.current;
      if (!open) return;

      const entry = entries[index ?? activeIndex];
      // Close first so the onChange fired by setDocument below is a no-op.
      applyPopup(CLOSED_POPUP);

      if (!editor || !entry) return;
      restoreHistoryEntryDocument(editor, entry);
      focusEditorAfterHistoryNavigation(editor);
    },
    [applyPopup, editor],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled || !editor) return false;
      if (shouldIgnoreInputHistoryKeyDown(event, isComposingRef.current)) return false;

      const state = popupRef.current;

      // Empty input is the only entry point. With non-empty input ArrowUp keeps
      // the editor's native cursor-up behaviour (e.g. moving within multi-line
      // drafts) instead of opening the history popup.
      if (!state.open) {
        if (event.key !== 'ArrowUp') return false;
        if (getMarkdownContent().trim().length > 0) return false;

        const entries = getInputHistory(scope);
        if (entries.length === 0) return false;

        applyPopup({ activeIndex: 0, entries, open: true });
        return true;
      }

      switch (event.key) {
        case 'ArrowUp': {
          setActiveIndex(state.activeIndex + 1);
          return true;
        }
        case 'ArrowDown': {
          // Moving newer than the most recent entry dismisses the popup, leaving
          // the input empty — symmetric with how it was opened.
          if (state.activeIndex === 0) close();
          else setActiveIndex(state.activeIndex - 1);
          return true;
        }
        case 'Tab': {
          confirm(state.activeIndex);
          return true;
        }
        case 'Escape': {
          close();
          return true;
        }
        // Enter is consumed earlier by onPressEnter; handled here defensively.
        case 'Enter': {
          confirm(state.activeIndex);
          return true;
        }
        default: {
          // Any other key (e.g. typing) cancels history and types normally.
          close();
          return false;
        }
      }
    },
    [
      applyPopup,
      close,
      confirm,
      editor,
      enabled,
      getMarkdownContent,
      isComposingRef,
      scope,
      setActiveIndex,
    ],
  );

  const handleEditorChange = useCallback(() => {
    // Real content changes while the popup is open (e.g. paste) dismiss it.
    if (popupRef.current.open) close();
  }, [close]);

  const ghostMarkdown = popup.open ? popup.entries[popup.activeIndex]?.markdown : undefined;

  return {
    close,
    confirm,
    ghostMarkdown,
    handleEditorChange,
    handleKeyDown,
    popup,
    reset: close,
    setActiveIndex,
  };
};
