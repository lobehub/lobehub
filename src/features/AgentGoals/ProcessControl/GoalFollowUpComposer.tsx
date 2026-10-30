'use client';

import { ChatInput, ChatInputActionBar, SendButton, useEditor } from '@lobehub/editor/react';
import { createStaticStyles, cssVar, Icon } from '@lobehub/ui';
import { $getRoot } from 'lexical';
import { PlusIcon } from 'lucide-react';
import type { FocusEvent, KeyboardEvent } from 'react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EditorCanvas } from '@/features/EditorCanvas';
import { useEnterToSend } from '@/hooks/useEnterToSend';

import { useFoldableComposer } from './useFoldableComposer';

/**
 * The result page's closing move: ask the goal's agent about what was just
 * delivered without hunting for the panel toggle. It owns no conversation of
 * its own — the text is handed to the host, which opens the goal conversation
 * beside the page and sends it there, so the reply lands where every other
 * question about this goal already lives.
 *
 * It rests as a small pill so the result stays the page's focus, and only
 * opens into the full input once the reader asks for it.
 */

const styles = createStaticStyles(({ css }) => ({
  // Pinned to the bottom of the page's scroll area. Collapsed, only the pill
  // takes pointer events, so the result text under the dock stays selectable.
  dock: css`
    pointer-events: none;

    position: sticky;
    z-index: 1;
    inset-block-end: 0;

    display: flex;
    justify-content: center;

    padding-block: 16px;
  `,
  // Open, the input sits over a fade so the result text scrolling underneath
  // never collides with the box.
  dockExpanded: css`
    pointer-events: auto;
    display: block;
    padding-block: 24px 16px;
    background: linear-gradient(to bottom, transparent, ${cssVar.colorBgLayout} 24px);
  `,
  pill: css`
    pointer-events: auto;
    cursor: pointer;

    display: inline-flex;
    gap: 8px;
    align-items: center;

    height: 40px;
    padding-inline: 16px 20px;
    border: 1px solid color-mix(in srgb, ${cssVar.colorBorderSecondary} 60%, transparent);
    border-radius: 999px;

    font-size: 14px;
    color: ${cssVar.colorTextSecondary};

    background: color-mix(in srgb, ${cssVar.colorBgElevated} 75%, transparent);
    backdrop-filter: blur(16px) saturate(1.2);
    box-shadow: ${cssVar.boxShadowSecondary};

    transition:
      color 0.2s,
      background 0.2s;

    &:hover {
      color: ${cssVar.colorText};
      background: color-mix(in srgb, ${cssVar.colorBgElevated} 90%, transparent);
    }
  `,
}));

interface GoalFollowUpComposerProps {
  /** Hidden rather than unmounted, so the draft outlives a tab switch. */
  hidden?: boolean;
  onSend: (message: string) => void;
}

const GoalFollowUpComposer = memo<GoalFollowUpComposerProps>(({ hidden, onSend }) => {
  const { t } = useTranslation('chat');
  const editor = useEditor();
  const { expanded, fold, open, triggerRef } = useFoldableComposer(editor);
  const [hasContent, setHasContent] = useState(false);
  const shouldSendOnEnter = useEnterToSend();

  const handleContentChange = useCallback(() => {
    editor
      ?.getLexicalEditor?.()
      ?.getEditorState()
      .read(() => setHasContent($getRoot().getTextContent().trim().length > 0));
  }, [editor]);

  const handleSubmit = useCallback(() => {
    const message = String(editor?.getDocument?.('markdown') ?? '').trim();
    if (!message) return;
    editor?.cleanDocument?.();
    setHasContent(false);
    fold();
    onSend(message);
  }, [editor, fold, onSend]);

  // Clicking away folds an empty input back into the pill; a draft keeps it
  // open so the reader can see what is still unsent.
  const handleBlur = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      if (hasContent || event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      fold();
    },
    [fold, hasContent],
  );

  // Escape always folds it; the editor stays mounted, so a draft is kept.
  // Focus goes back to the pill, so the keyboard can reopen the draft.
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') fold(true);
    },
    [fold],
  );

  return (
    // The dock itself carries `hidden`: a wrapper would become the sticky
    // element's containing block and unpin it from the page bottom.
    <div
      className={expanded ? `${styles.dock} ${styles.dockExpanded}` : styles.dock}
      hidden={hidden}
    >
      {!expanded && (
        <button className={styles.pill} ref={triggerRef} type={'button'} onClick={open}>
          <Icon icon={PlusIcon} size={16} />
          {t('goalProcess.result.followUp.trigger')}
        </button>
      )}
      {/* Kept mounted while folded, so Escape never throws a draft away. */}
      <div hidden={!expanded} onBlur={handleBlur} onKeyDown={handleKeyDown}>
        <ChatInput
          maxHeight={200}
          minHeight={48}
          footer={
            <ChatInputActionBar
              // The bar spreads `left` and `right` apart; without a left slot the
              // send button would sit on the left edge.
              left={<span />}
              style={{ paddingInline: 8 }}
              right={
                <SendButton
                  disabled={!hasContent}
                  shape={'round'}
                  title={t('goalProcess.result.followUp.send')}
                  type={'primary'}
                  onClick={handleSubmit}
                />
              }
            />
          }
        >
          <EditorCanvas
            editor={editor}
            floatingToolbar={false}
            placeholder={t('goalProcess.result.followUp.placeholder')}
            style={{ paddingBlock: 0 }}
            onContentChange={handleContentChange}
            onPressEnter={({ event }) => {
              if (shouldSendOnEnter(event)) {
                handleSubmit();
                return true;
              }
            }}
          />
        </ChatInput>
      </div>
    </div>
  );
});

GoalFollowUpComposer.displayName = 'GoalFollowUpComposer';

export default GoalFollowUpComposer;
