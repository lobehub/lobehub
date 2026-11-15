'use client';

import { nanoid } from '@lobechat/utils';
import { Button, Flexbox, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckIcon, MessageCirclePlusIcon } from 'lucide-react';
import type { CSSProperties, PointerEvent, ReactNode } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { fileChatSelectors, useFileStore } from '@/store/file';

import { useConversationStore } from '../../../store';
import {
  createTextSelectionContext,
  getRangeFirstLineRect,
  getSelectionToolbarPosition,
  isSameTextSelectionContext,
  isTextSelectionAdded,
  type SelectionToolbarPosition,
} from './helpers';

interface ActiveSelection {
  position: SelectionToolbarPosition;
  text: string;
}

interface TextSelectionActionLayerProps {
  children: ReactNode;
  disabled?: boolean;
}

const styles = stylex.create({
  root: { display: 'contents' },
  toolbar: {
    position: 'fixed',
    zIndex: 10000,
    padding: '4px',
    borderWidth: '1px',
    borderStyle: 'solid',
    // Theme tokens, not the CSS light-dark function: the build rewrites it into
    // `--lightningcss-*` fallbacks that never resolve here, which left the border
    // two-toned and the background transparent. The alpha fill reads as a visible ring
    // on both themes; dark `colorBorder` (#202020) vanished against the chat body, and
    // in light the elevated and container backgrounds are both white.
    borderColor: cssVar.colorFill,
    borderRadius: '999px',
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
    boxShadow: cssVar.boxShadowSecondary,
  },
  placeTop: { transform: 'translate(-50%, -100%)' },
  placeBottom: { transform: 'translate(-50%, 0)' },
  added: {
    display: 'flex',
    gap: '4px',
    alignItems: 'center',
    height: '24px',
    paddingInline: '8px',
    fontSize: cssVar.fontSizeSM,
    fontWeight: 500,
    lineHeight: 1,
    color: cssVar.colorText,
    whiteSpace: 'nowrap',
  },
  addedIcon: { flexShrink: 0, color: cssVar.colorSuccess },
});

const focusChatInputSoon = () => {
  window.setTimeout(() => {
    // The Conversation ChatInput syncs the active editor here. In a portal
    // thread, the newly mounted input becomes the latest registered editor.
    useChatStore.getState().mainInputEditor?.focus();
  }, 160);
};

const TextSelectionActionLayer = memo<TextSelectionActionLayerProps>(({ children, disabled }) => {
  const { t } = useTranslation('chat');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [activeSelection, setActiveSelection] = useState<ActiveSelection | null>(null);

  const composerTarget = useConversationStore((s) => s.composerTarget);
  const addChatContextSelection = useFileStore((s) => s.addChatContextSelection);
  const contextSelections = useFileStore(
    fileChatSelectors.chatContextSelections(
      composerTarget.writable ? composerTarget.contextKey : undefined,
    ),
  );
  const isAdded = useMemo(
    () => !!activeSelection && isTextSelectionAdded(contextSelections, activeSelection.text),
    [activeSelection, contextSelections],
  );

  const hideToolbar = useCallback(() => {
    setActiveSelection(null);
  }, []);

  const clearNativeSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    hideToolbar();
  }, [hideToolbar]);

  const updateSelection = useCallback(() => {
    if (disabled || !composerTarget.writable) {
      hideToolbar();
      return;
    }

    const root = rootRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      hideToolbar();
      return;
    }

    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    if (!anchorNode || !focusNode || !root.contains(anchorNode) || !root.contains(focusNode)) {
      hideToolbar();
      return;
    }

    const text = selection.toString().trim();
    if (!text) {
      hideToolbar();
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = getRangeFirstLineRect(range);
    if (!rect) {
      hideToolbar();
      return;
    }

    setActiveSelection({
      position: getSelectionToolbarPosition(rect, {
        selectionBottom: range.getBoundingClientRect().bottom,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
      }),
      text,
    });
  }, [composerTarget.writable, disabled, hideToolbar]);

  const scheduleSelectionUpdate = useCallback(() => {
    window.setTimeout(updateSelection, 0);
  }, [updateSelection]);

  useEffect(() => {
    if (!activeSelection) return;

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (toolbarRef.current?.contains(target) || rootRef.current?.contains(target)) return;

      hideToolbar();
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('resize', hideToolbar);
    window.addEventListener('scroll', hideToolbar, true);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('resize', hideToolbar);
      window.removeEventListener('scroll', hideToolbar, true);
    };
  }, [activeSelection, hideToolbar]);

  const addSelectionToConversation = useCallback(() => {
    const text = activeSelection?.text;
    if (!text || !composerTarget.writable) return;

    const currentSelections = fileChatSelectors.chatContextSelections(composerTarget.contextKey)(
      useFileStore.getState(),
    );
    const existing = currentSelections.find((item) => isSameTextSelectionContext(item, text));
    const context =
      existing ??
      createTextSelectionContext({
        id: `selection-${nanoid(6)}`,
        selectedText: text,
        title: t('textSelection.title'),
      });

    addChatContextSelection({ contextKey: composerTarget.contextKey, selection: context });
  }, [activeSelection?.text, addChatContextSelection, composerTarget, t]);

  // The context is deduped by content, so adding again moves it to the front of the
  // composer and hands focus to the input for the follow-up question.
  const handleAddAgain = useCallback(() => {
    addSelectionToConversation();
    toast.success(t('textSelection.added'));
    clearNativeSelection();
    focusChatInputSoon();
  }, [addSelectionToConversation, clearNativeSelection, t]);

  const handleToolbarPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const toolbarStyle = activeSelection
    ? ({
        left: activeSelection.position.left,
        top: activeSelection.position.top,
      } satisfies CSSProperties)
    : undefined;

  return (
    <div
      {...stylex.props(styles.root)}
      ref={rootRef}
      onKeyUp={scheduleSelectionUpdate}
      onPointerUp={scheduleSelectionUpdate}
    >
      {children}
      {activeSelection &&
        createPortal(
          <Flexbox
            horizontal
            align={'center'}
            ref={toolbarRef}
            style={toolbarStyle}
            className={
              stylex.props(
                styles.toolbar,
                activeSelection.position.placement === 'top' ? styles.placeTop : styles.placeBottom,
              ).className
            }
            onPointerDown={handleToolbarPointerDown}
          >
            {/* Mounted for the toolbar's lifetime so screen readers announce the
                added state when its text appears; empty, it takes no space. */}
            <span role={'status'}>
              {isAdded && (
                <span {...stylex.props(styles.added)}>
                  <CheckIcon size={14} strokeWidth={2.5} {...stylex.props(styles.addedIcon)} />
                  {t('textSelection.addedState')}
                </span>
              )}
            </span>
            {isAdded ? (
              <Button shape={'round'} size={'small'} type={'text'} onClick={handleAddAgain}>
                {t('textSelection.addAgain')}
              </Button>
            ) : (
              // Primary is the inverted pair (colorPrimary fill + colorBgLayout text):
              // near-white on near-black in the neutral dark theme, so it stays legible.
              <Button
                icon={<MessageCirclePlusIcon size={14} />}
                shape={'round'}
                size={'small'}
                type={'primary'}
                // Selection and toolbar stay put: flipping to the added state in place
                // is the confirmation.
                onClick={addSelectionToConversation}
              >
                {t('textSelection.addToConversation')}
              </Button>
            )}
          </Flexbox>,
          document.body,
        )}
    </div>
  );
});

TextSelectionActionLayer.displayName = 'TextSelectionActionLayer';

export default TextSelectionActionLayer;
