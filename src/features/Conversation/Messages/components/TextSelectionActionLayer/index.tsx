'use client';

import { Button, copyToClipboard, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckIcon, CopyIcon, TextQuoteIcon } from 'lucide-react';
import type { CSSProperties, PointerEvent, ReactNode } from 'react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import type { ChatInputEditor } from '@/features/ChatInput/hooks/useChatInputEditor';
import { useChatStore } from '@/store/chat';

import { useConversationStore } from '../../../store';
import { getRangeFirstLineRect, getSelectionToolbarPosition } from './helpers';
import { quoteIntoEditor } from './quote';

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

const styles = stylex.create({
  root: { display: 'contents' },
  toolbar: {
    position: 'fixed',
    zIndex: 10000,
    transform: 'translate(-50%, -100%)',
    padding: '4px',
    borderWidth: '1px',
    borderStyle: 'solid',
    // Theme tokens, not the CSS light-dark function: the build rewrites it into
    // `--lightningcss-*` fallbacks that never resolve here, which left the border
    // two-toned and the background transparent.
    borderColor: cssVar.colorBorder,
    borderRadius: '999px',
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
    boxShadow: '0 8px 24px rgb(0 0 0 / 12%), 0 2px 8px rgb(0 0 0 / 8%)',
  },
});

/** How long the Copy button reads "Copied" before it can be used again. */
const COPIED_FEEDBACK_MS = 1500;

/**
 * The composer that receives a quote: this conversation's own ChatInput when it has one,
 * otherwise the most recently registered chat input.
 */
const getComposerEditor = (conversationEditor: ChatInputEditor | null) =>
  (conversationEditor ?? useChatStore.getState().mainInputEditor)?.instance?.getLexicalEditor?.() ??
  undefined;

const TextSelectionActionLayer = memo<TextSelectionActionLayerProps>(({ children, disabled }) => {
  const { t } = useTranslation('chat');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [activeSelection, setActiveSelection] = useState<ActiveSelection | null>(null);
  const [copied, setCopied] = useState(false);

  const composerTarget = useConversationStore((s) => s.composerTarget);
  const conversationEditor = useConversationStore((s) => s.editor as ChatInputEditor | null);

  const hideToolbar = useCallback(() => {
    setActiveSelection(null);
    setCopied(false);
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

    const text = selection.toString();
    if (!text.trim()) {
      hideToolbar();
      return;
    }

    const rect = getRangeFirstLineRect(selection.getRangeAt(0));
    if (!rect) {
      hideToolbar();
      return;
    }

    setActiveSelection((previous) => {
      if (previous?.text !== text) setCopied(false);
      return { position: getSelectionToolbarPosition(rect, window.innerWidth), text };
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

    // Escape closes only the toolbar, and only while it is showing.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      hideToolbar();
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', hideToolbar);
    window.addEventListener('scroll', hideToolbar, true);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', hideToolbar);
      window.removeEventListener('scroll', hideToolbar, true);
    };
  }, [activeSelection, hideToolbar]);

  // The quote goes into the draft itself, where the user sees it, can edit it, and keeps
  // typing below it; focusing the composer there is the confirmation.
  const handleQuote = useCallback(() => {
    const text = activeSelection?.text;
    const editor = getComposerEditor(conversationEditor);
    if (!text || !editor || !composerTarget.writable) return;

    if (quoteIntoEditor(editor, text)) clearNativeSelection();
  }, [activeSelection?.text, clearNativeSelection, composerTarget.writable, conversationEditor]);

  const handleCopy = useCallback(async () => {
    const text = activeSelection?.text;
    if (!text) return;

    await copyToClipboard(text.trim());
    setCopied(true);
  }, [activeSelection?.text]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

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
            className={stylex.props(styles.toolbar).className}
            gap={2}
            ref={toolbarRef}
            style={toolbarStyle}
            onPointerDown={handleToolbarPointerDown}
          >
            <Button
              icon={<TextQuoteIcon size={14} />}
              size={'small'}
              type={'text'}
              onClick={handleQuote}
            >
              {t('textSelection.quote')}
            </Button>
            <Button
              icon={copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
              size={'small'}
              type={'text'}
              onClick={handleCopy}
            >
              {t(copied ? 'textSelection.copied' : 'textSelection.copy')}
            </Button>
          </Flexbox>,
          document.body,
        )}
    </div>
  );
});

TextSelectionActionLayer.displayName = 'TextSelectionActionLayer';

export default TextSelectionActionLayer;
