'use client';

import { nanoid } from '@lobechat/utils';
import { Flexbox } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { MessageCirclePlusIcon } from 'lucide-react';
import type { CSSProperties, PointerEvent, ReactNode } from 'react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { useFileStore } from '@/store/file';

import {
  createTextSelectionContext,
  getRangeFirstLineRect,
  getSelectionToolbarPosition,
  isSameTextSelectionContext,
} from './helpers';

interface ActiveSelection {
  position: {
    left: number;
    top: number;
  };
  text: string;
}

interface TextSelectionActionLayerProps {
  children: ReactNode;
  disabled?: boolean;
}

const styles = createStaticStyles(({ css }) => ({
  root: css`
    display: contents;
  `,
  toolbar: css`
    position: fixed;
    z-index: 10000;
    transform: translate(-50%, -100%);

    padding: 4px;
    border: 1px solid light-dark(rgb(229 231 235), rgb(64 64 64));
    border-radius: 999px;

    background: light-dark(#fff, #1f1f1f);
    box-shadow:
      0 8px 24px rgb(0 0 0 / 12%),
      0 2px 8px rgb(0 0 0 / 8%);
  `,
}));

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

  const addChatContextSelection = useFileStore((s) => s.addChatContextSelection);

  const hideToolbar = useCallback(() => {
    setActiveSelection(null);
  }, []);

  const clearNativeSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    hideToolbar();
  }, [hideToolbar]);

  const updateSelection = useCallback(() => {
    if (disabled) {
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

    const rect = getRangeFirstLineRect(selection.getRangeAt(0));
    if (!rect) {
      hideToolbar();
      return;
    }

    setActiveSelection({
      position: getSelectionToolbarPosition(rect, window.innerWidth),
      text,
    });
  }, [disabled, hideToolbar]);

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
    if (!text) return;

    const currentSelections = useFileStore.getState().chatContextSelections;
    const existing = currentSelections.find((item) => isSameTextSelectionContext(item, text));
    const context =
      existing ??
      createTextSelectionContext({
        id: `selection-${nanoid(6)}`,
        selectedText: text,
        title: t('textSelection.title'),
      });

    addChatContextSelection(context);
    toast.success(t('textSelection.added'));
  }, [activeSelection?.text, addChatContextSelection, t]);

  const handleAddToConversation = useCallback(() => {
    addSelectionToConversation();
    clearNativeSelection();
    focusChatInputSoon();
  }, [addSelectionToConversation, clearNativeSelection]);

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
      className={styles.root}
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
            className={styles.toolbar}
            gap={2}
            ref={toolbarRef}
            style={toolbarStyle}
            onPointerDown={handleToolbarPointerDown}
          >
            <Button
              icon={<MessageCirclePlusIcon size={14} />}
              size={'small'}
              type={'text'}
              onClick={handleAddToConversation}
            >
              {t('textSelection.addToConversation')}
            </Button>
          </Flexbox>,
          document.body,
        )}
    </div>
  );
});

TextSelectionActionLayer.displayName = 'TextSelectionActionLayer';

export default TextSelectionActionLayer;
