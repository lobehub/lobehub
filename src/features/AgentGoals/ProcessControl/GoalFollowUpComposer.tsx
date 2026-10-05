'use client';

import { ChatInput, ChatInputActionBar, SendButton, useEditor } from '@lobehub/editor/react';
import { createStaticStyles, cssVar } from 'antd-style';
import { $getRoot } from 'lexical';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EditorCanvas } from '@/features/EditorCanvas';
import { useEnterToSend } from '@/hooks/useEnterToSend';

/**
 * The result page's closing move: ask the goal's agent about what was just
 * delivered without hunting for the panel toggle. It owns no conversation of
 * its own — the text is handed to the host, which opens the goal conversation
 * beside the page and sends it there, so the reply lands where every other
 * question about this goal already lives.
 */

const styles = createStaticStyles(({ css }) => ({
  // Pinned to the bottom of the page's scroll area, over a fade so the result
  // text scrolling underneath never collides with the box.
  dock: css`
    position: sticky;
    z-index: 1;
    inset-block-end: 0;

    padding-block: 24px 16px;

    background: linear-gradient(to bottom, transparent, ${cssVar.colorBgLayout} 24px);
  `,
}));

interface GoalFollowUpComposerProps {
  onSend: (message: string) => void;
}

const GoalFollowUpComposer = memo<GoalFollowUpComposerProps>(({ onSend }) => {
  const { t } = useTranslation('chat');
  const editor = useEditor();
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
    onSend(message);
  }, [editor, onSend]);

  return (
    <div className={styles.dock}>
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
  );
});

GoalFollowUpComposer.displayName = 'GoalFollowUpComposer';

export default GoalFollowUpComposer;
