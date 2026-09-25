'use client';

import type { DocumentCommentSelectionAnchor } from '@lobechat/types';
import { type IEditor } from '@lobehub/editor';
import { HIDE_TOOLBAR_COMMAND } from '@lobehub/editor';
import { type ChatInputActionsProps } from '@lobehub/editor/react';
import { Block, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { MessageSquarePlus } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { captureSelectionAnchor } from '@/features/PageEditor/DocumentComments/anchor/textAnchor';
import { usePermission } from '@/hooks/usePermission';

import { usePageEditorStore } from '../store';

const styles = createStaticStyles(({ css }) => ({
  addComment: css`
    border-radius: 6px;
    color: ${cssVar.colorTextDescription};

    &:hover {
      color: ${cssVar.colorTextSecondary};
    }
  `,
}));

/**
 * The "Comment" action on the body's selection toolbar — the entry point for an
 * anchored comment, sitting next to Ask Lobe AI because both act on whatever
 * the reader just selected.
 *
 * The anchor is read from the native DOM selection rather than the editor's
 * `getSelection()`: that returns Lexical node keys, which are regenerated on
 * every load and therefore useless the moment the comment is persisted.
 *
 * It is read on pointer-down, not on click. The toolbar is portalled to the
 * document body, so pressing it collapses the body's selection as the pointer
 * event's default action — by the time a click handler runs there is nothing
 * left to quote. Cancelling that default also keeps the run visibly selected
 * while the composer takes over.
 */
export const useAddCommentItem = (
  editor: IEditor | undefined,
  documentId: string | undefined,
): ChatInputActionsProps['items'] => {
  const { t } = useTranslation('file');
  const { allowed: canComment } = usePermission('create_content');
  const setPendingCommentAnchor = usePageEditorStore((s) => s.setPendingCommentAnchor);
  const capturedAnchorRef = useRef<DocumentCommentSelectionAnchor | null>(null);

  return useMemo(() => {
    if (!editor || !documentId || !canComment) return [];

    const label = t('pageEditor.comments.anchor.add');

    return [
      {
        children: (
          <Block
            clickable
            horizontal
            align="center"
            className={styles.addComment}
            gap={8}
            paddingBlock={6}
            paddingInline={12}
            variant="borderless"
            onClick={() => {
              const anchor =
                capturedAnchorRef.current ?? captureSelectionAnchor(editor.getRootElement?.());
              capturedAnchorRef.current = null;
              if (!anchor) return;

              // The composer answers the selection itself: beside the run in
              // the gutter, or scrolled into view below the body on a narrow
              // pane (see `Composer`'s anchor modes).
              setPendingCommentAnchor({ anchor, documentId });
              editor.dispatchCommand(HIDE_TOOLBAR_COMMAND, undefined);
              editor.blur();
            }}
            onMouseDown={(event) => {
              event.preventDefault();
              capturedAnchorRef.current = captureSelectionAnchor(editor.getRootElement?.());
            }}
          >
            <Icon icon={MessageSquarePlus} size={16} />
            <span>{label}</span>
          </Block>
        ),
        key: 'add-document-comment',
        label,
        onClick: () => {},
      },
    ];
  }, [canComment, documentId, editor, setPendingCommentAnchor, t]);
};
