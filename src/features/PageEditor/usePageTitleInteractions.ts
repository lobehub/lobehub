'use client';

import {
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { focusEditorFirstLine } from '@/features/EditorCanvas/focusEditorStartLine';
import { useDocumentStore } from '@/store/document';
import { editorSelectors } from '@/store/document/slices/editor';
import { truncateByWeightedLength } from '@/utils/textLength';

import { usePageEditorStore } from './store';
import {
  findPageTitleInput,
  flattenTitleLineBreaks,
  shouldTitleArrowDownEnterBody,
} from './titleBodyNavigation';
import { usePageEditable } from './usePageEditable';

/** Shown in the icon picker while it is open on a page that has no icon yet. */
export const DEFAULT_PAGE_EMOJI = '📄';

/** Title a new page is created with (see `pageList.untitled`), in any language it was created in. */
const DEFAULT_UNTITLED_TITLE = 'Untitled';

const TITLE_MAX_WEIGHTED_LENGTH = 100;

// Enter that confirms an IME candidate (Chinese/Japanese input) must not submit
// the title: moving focus to the body mid-composition commits the text there too.
// Safari reports the confirming keydown with isComposing=false but keyCode 229.
export const isTitleSubmitKey = (e: {
  key: string;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean };
}) => e.key === 'Enter' && !e.nativeEvent?.isComposing && e.keyCode !== 229;

const isTitleArrowDownKey = (e: KeyboardEvent<HTMLTextAreaElement>) =>
  e.key === 'ArrowDown' &&
  !e.shiftKey &&
  !e.altKey &&
  !e.metaKey &&
  !e.ctrlKey &&
  !e.nativeEvent.isComposing;

/**
 * Split the title at the caret for Enter: the text before the selection stays
 * the title, the text after it moves to the body (the selection itself is
 * replaced, as Enter would in any text field).
 */
export const splitTitleAtSelection = (
  value: string,
  selectionStart: number,
  selectionEnd: number,
) => ({ body: value.slice(selectionEnd), title: value.slice(0, selectionStart) });

/**
 * A page still carrying the title it was created with and an empty body is a
 * page nobody has started yet.
 */
export const isUnstartedPage = (
  title: string | undefined,
  content: string,
  untitledTitle: string,
) => {
  const trimmed = title?.trim();
  if (!trimmed || content.trim()) return false;
  return trimmed === untitledTitle || trimmed === DEFAULT_UNTITLED_TITLE;
};

/** Another text field, or the body, already has the user's keyboard. */
const isTypingElsewhere = (input: HTMLTextAreaElement) => {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === input) return false;
  return (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement ||
    active.isContentEditable
  );
};

/**
 * Behaviour of the page title and its icon, following AFFiNE's doc title:
 * - Enter splits the title at the caret; the rest continues as the body's first line.
 * - ArrowDown moves into the body once there is no title line below the caret.
 * - The title stays one line: line breaks that reach it become spaces.
 * - A page nobody has started yet opens with its default title selected.
 * - "Choose icon" previews the default icon but saves only a picked one.
 *
 * `containerRef` holds the title input.
 */
export const usePageTitleInteractions = (containerRef: RefObject<HTMLElement | null>) => {
  const { t } = useTranslation('file');

  const documentId = usePageEditorStore((s) => s.documentId);
  // Gate the title/emoji on the same state as the body editor: edit permission
  // AND not locked by another member (nor pending / save-blocked). The lock makes
  // the whole page read-only, so metadata must not stay editable behind it.
  // `metaReadOnly` additionally locks just the meta (title + emoji) while leaving
  // the body editable — used for managed docs like a skill's `SKILL.md` index,
  // whose identity is renamed through skill APIs, never a plain title save.
  const isMetaReadOnly = usePageEditorStore((s) => s.metaReadOnly);
  const bodyEditable = usePageEditable();
  const canEdit = bodyEditable && !isMetaReadOnly;
  const editor = usePageEditorStore((s) => s.editor);
  const emoji = usePageEditorStore((s) => s.emoji);
  const title = usePageEditorStore((s) => s.title);
  const setEmoji = usePageEditorStore((s) => s.setEmoji);
  const setTitle = usePageEditorStore((s) => s.setTitle);
  const handleTitleSubmit = usePageEditorStore((s) => s.handleTitleSubmit);
  const isDocumentLoading = useDocumentStore(editorSelectors.isDocumentLoading(documentId));
  const content = useDocumentStore((s) =>
    documentId ? editorSelectors.content(documentId)(s) : '',
  );

  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  // Caret to put back after line breaks were flattened out of the typed value:
  // writing the cleaned value into the textarea moves its caret to the end.
  const pendingCaretRef = useRef<number | null>(null);
  const autoFocusCheckedRef = useRef<string | undefined>(undefined);

  useLayoutEffect(() => {
    const caret = pendingCaretRef.current;
    if (caret === null) return;
    pendingCaretRef.current = null;
    findPageTitleInput(containerRef.current)?.setSelectionRange(caret, caret);
  }, [containerRef, title]);

  // A page nobody has started yet (just created: default title, empty body)
  // opens with its title focused and selected, so typing names it straight
  // away instead of first deleting the placeholder title. Decided once, the
  // first moment the page is loaded and writable — never later, when the user
  // may be typing.
  useEffect(() => {
    if (!documentId || isDocumentLoading || !canEdit) return;
    if (autoFocusCheckedRef.current === documentId) return;

    const input = findPageTitleInput(containerRef.current);
    if (!input) return;
    autoFocusCheckedRef.current = documentId;

    if (!isUnstartedPage(title, content, t('pageList.untitled'))) return;
    if (isTypingElsewhere(input)) return;

    input.focus();
    input.select();
  }, [canEdit, containerRef, content, documentId, isDocumentLoading, t, title]);

  const handleTitleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    if (!canEdit) return;

    const raw = e.target.value;
    const flattened = flattenTitleLineBreaks(raw);
    const truncated = truncateByWeightedLength(flattened, TITLE_MAX_WEIGHTED_LENGTH);
    if (flattened !== raw) {
      const caret = flattenTitleLineBreaks(raw.slice(0, e.target.selectionEnd)).length;
      pendingCaretRef.current = Math.min(caret, truncated.length);
    }

    setTitle(truncated);
  };

  const handleTitleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isTitleArrowDownKey(e)) {
      if (!bodyEditable || !shouldTitleArrowDownEnterBody(e.currentTarget)) return;
      e.preventDefault();
      focusEditorFirstLine(editor);
      return;
    }

    if (!canEdit || !isTitleSubmitKey(e)) return;

    e.preventDefault();
    const { selectionEnd, selectionStart, value } = e.currentTarget;
    const split = splitTitleAtSelection(value, selectionStart, selectionEnd);
    if (split.title !== value) setTitle(split.title);
    handleTitleSubmit(split.body);
  };

  const emojiPicker = {
    onChange: (next: string) => {
      if (!canEdit) return;
      setEmoji(next);
      setShowEmojiPicker(false);
    },
    onDelete: () => {
      if (!canEdit) return;
      setEmoji(undefined);
      setShowEmojiPicker(false);
    },
    // Opening it on a page without an icon only previews the default icon.
    onOpen: () => {
      if (!canEdit) return;
      setShowEmojiPicker(true);
    },
    onOpenChange: (open: boolean) => {
      if (!canEdit) return;
      setShowEmojiPicker(open);
    },
    open: showEmojiPicker,
    value: emoji || (showEmojiPicker ? DEFAULT_PAGE_EMOJI : undefined),
    visible: !!emoji || showEmojiPicker,
  };

  return {
    canEdit,
    emojiPicker,
    handleTitleChange,
    handleTitleKeyDown,
    showTitleSkeleton: isDocumentLoading && !title,
    title,
  };
};
