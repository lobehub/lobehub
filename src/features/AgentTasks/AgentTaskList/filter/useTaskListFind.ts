import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Typed text is committed to the `content` condition after this pause; each
 * commit is a list request. Shared by the find box and the filter bar's chip.
 */
export const TASK_FILTER_CONTENT_COMMIT_DELAY_MS = 400;

interface UseTaskListFindOptions {
  /** The list's committed `content` condition (trimmed by the filter). */
  content?: string;
  onChange: (content: string) => void;
}

/**
 * State of the Tasks page find box: a draft committed to the `content` filter
 * after a pause, opened by Mod+F, cleared and closed by Escape.
 */
export const useTaskListFind = ({ content = '', onChange }: UseTaskListFindOptions) => {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(content);
  const [focusRequest, setFocusRequest] = useState(0);
  // Set once the box is cleared, so the blur that follows cannot commit the old text again.
  const discardBlurRef = useRef(false);

  // Follow the condition when it changes elsewhere (the filter menu, "Clear"). The
  // committed value is trimmed, so a draft that only differs by spaces is kept as typed.
  const [syncedContent, setSyncedContent] = useState(content);
  if (syncedContent !== content) {
    setSyncedContent(content);
    if (draft.trim() !== content) setDraft(content);
    // Cleared elsewhere while nobody is typing in it: an empty box has nothing to keep.
    if (!content && !focused) setOpen(false);
  }

  useEffect(() => {
    if (draft.trim() === content) return;
    const timer = setTimeout(() => onChange(draft), TASK_FILTER_CONTENT_COMMIT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [content, draft, onChange]);

  const openFind = useCallback(() => {
    discardBlurRef.current = false;
    setOpen(true);
    // Bumped on every press, so a repeat Mod+F re-selects the text.
    setFocusRequest((nonce) => nonce + 1);
  }, []);

  const commit = useCallback(() => {
    if (draft.trim() !== content) onChange(draft);
  }, [content, draft, onChange]);

  const clearAndClose = useCallback(() => {
    discardBlurRef.current = true;
    setOpen(false);
    setDraft('');
    if (content) onChange('');
  }, [content, onChange]);

  // A box shown for an existing condition becomes an open one once focused, so
  // erasing the text to type another does not collapse it under the cursor.
  const focus = useCallback(() => {
    setFocused(true);
    setOpen(true);
  }, []);

  const blur = useCallback(() => {
    setFocused(false);
    if (discardBlurRef.current) {
      discardBlurRef.current = false;
      return;
    }
    commit();
    // An empty box has nothing to keep on screen.
    if (!draft.trim()) setOpen(false);
  }, [commit, draft]);

  return {
    blur,
    clearAndClose,
    commit,
    draft,
    // An active text condition always shows in the box, so it stays visible and editable.
    expanded: open || !!content,
    focus,
    focusRequest,
    openFind,
    setDraft,
  };
};
