import type { IEditor } from '@lobehub/editor';
import type { RefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';

import type { ChatInputHistoryEntry } from '../inputHistoryStorage';
import { getInputHistory } from '../inputHistoryStorage';

interface InputHistoryNavigatorOptions {
  applyEntry: (entry: ChatInputHistoryEntry) => void;
  clearInput: () => void;
  getEntries: () => ChatInputHistoryEntry[];
  getMarkdownContent: () => string;
}

export interface InputHistoryNavigator {
  handleKeyDown: (event: KeyboardEvent) => boolean;
  reset: () => void;
}

export const createInputHistoryNavigator = ({
  applyEntry,
  clearInput,
  getEntries,
  getMarkdownContent,
}: InputHistoryNavigatorOptions): InputHistoryNavigator => {
  let entries: ChatInputHistoryEntry[] = [];
  let cursor = -1;

  const reset = () => {
    entries = [];
    cursor = -1;
  };

  const applyCurrentEntry = () => {
    const entry = entries[cursor];
    if (!entry) return false;

    applyEntry(entry);
    return true;
  };

  const showOlderEntry = () => {
    if (cursor === -1) {
      // Empty input is the only entry point. Once history mode starts, users can
      // keep pressing ArrowUp/ArrowDown even though restored entries are non-empty.
      // Example: with "line 1\nline 2" in the editor, ArrowUp should move the
      // cursor up instead of replacing the draft with the previous prompt.
      if (getMarkdownContent().trim().length > 0) return false;

      entries = getEntries();
      if (entries.length === 0) return false;

      cursor = 0;
      return applyCurrentEntry();
    }

    cursor = Math.min(cursor + 1, entries.length - 1);
    return applyCurrentEntry();
  };

  const showNewerEntry = () => {
    if (cursor === -1) return false;

    if (cursor === 0) {
      reset();
      clearInput();
      return true;
    }

    cursor -= 1;
    return applyCurrentEntry();
  };

  return {
    handleKeyDown: (event) => {
      if (event.key === 'ArrowUp') return showOlderEntry();
      if (event.key === 'ArrowDown') return showNewerEntry();

      reset();
      return false;
    },
    reset,
  };
};

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

interface UseChatInputHistoryOptions {
  editor?: IEditor;
  enabled: boolean;
  getMarkdownContent: () => string;
  isComposingRef: RefObject<boolean>;
}

const HISTORY_SET_DOCUMENT_OPTIONS = { keepHistory: true };

const focusEditorAfterHistoryNavigation = (editor: IEditor, onFocusRestored: () => void) => {
  requestAnimationFrame(() => {
    // setDocument/cleanDocument can make the Lexical root lose focus; keep
    // keyboard navigation active so ArrowUp can continue walking prompt history.
    editor.focus();
    onFocusRestored();
  });
};

const restoreHistoryEntryDocument = (editor: IEditor, entry: ChatInputHistoryEntry) => {
  if (!entry.json) {
    editor.setDocument('markdown', entry.markdown, HISTORY_SET_DOCUMENT_OPTIONS);
    return;
  }

  try {
    editor.setDocument('json', entry.json, HISTORY_SET_DOCUMENT_OPTIONS);
  } catch {
    // Example: a rich-input list/code node can fail after rich input is disabled;
    // markdown stays portable across different chat input plugin sets.
    editor.setDocument('markdown', entry.markdown, HISTORY_SET_DOCUMENT_OPTIONS);
  }
};

export const useChatInputHistory = ({
  editor,
  enabled,
  getMarkdownContent,
  isComposingRef,
}: UseChatInputHistoryOptions) => {
  const navigatorRef = useRef<InputHistoryNavigator | null>(null);
  const skipNextBlurResetRef = useRef(false);
  const skipNextChangeResetRef = useRef(false);

  const runHistoryDocumentMutation = useCallback(
    (mutation: (editor: IEditor) => void) => {
      if (!editor) return;

      skipNextBlurResetRef.current = true;
      skipNextChangeResetRef.current = true;

      mutation(editor);
      focusEditorAfterHistoryNavigation(editor, () => {
        skipNextBlurResetRef.current = false;
      });
    },
    [editor],
  );

  const restoreEntry = useCallback(
    (entry: ChatInputHistoryEntry) => {
      runHistoryDocumentMutation((editor) => {
        restoreHistoryEntryDocument(editor, entry);
      });
    },
    [runHistoryDocumentMutation],
  );

  const clearInput = useCallback(() => {
    runHistoryDocumentMutation((editor) => {
      editor.cleanDocument();
    });
  }, [runHistoryDocumentMutation]);

  const getNavigator = useCallback(() => {
    if (!navigatorRef.current) {
      navigatorRef.current = createInputHistoryNavigator({
        applyEntry: restoreEntry,
        clearInput,
        getEntries: getInputHistory,
        getMarkdownContent,
      });
    }

    return navigatorRef.current;
  }, [clearInput, getMarkdownContent, restoreEntry]);

  useEffect(() => {
    navigatorRef.current = null;
  }, [getNavigator]);

  const reset = useCallback(() => {
    navigatorRef.current?.reset();
  }, []);

  const handleEditorBlur = useCallback(() => {
    if (skipNextBlurResetRef.current) {
      // Example: restoring "latest" may briefly blur Lexical before rAF focus;
      // keep the cursor so the next ArrowUp can continue to "older".
      skipNextBlurResetRef.current = false;
      return;
    }

    reset();
  }, [reset]);

  const handleEditorChange = useCallback(() => {
    if (skipNextChangeResetRef.current) {
      skipNextChangeResetRef.current = false;
      return;
    }

    reset();
  }, [reset]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled || !editor) return false;

      if (shouldIgnoreInputHistoryKeyDown(event, isComposingRef.current)) return false;

      return getNavigator().handleKeyDown(event);
    },
    [editor, enabled, getNavigator, isComposingRef],
  );

  return {
    handleEditorBlur,
    handleEditorChange,
    handleKeyDown,
    reset,
  };
};
