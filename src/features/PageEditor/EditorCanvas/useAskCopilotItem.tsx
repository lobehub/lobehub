'use client';

import { DEFAULT_INBOX_AVATAR } from '@lobechat/const';
import { nanoid } from '@lobechat/utils';
import { type IEditor } from '@lobehub/editor';
import { HIDE_TOOLBAR_COMMAND } from '@lobehub/editor';
import { type ChatInputActionsProps } from '@lobehub/editor/react';
import { Avatar, Block } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFileStore } from '@/store/file';
import { useGlobalStore } from '@/store/global';

import { usePageEditorStore } from '../store';

const styles = createStaticStyles(({ css }) => ({
  askCopilot: css`
    border-radius: 6px;
    color: ${cssVar.colorTextDescription};

    &:hover {
      color: ${cssVar.colorTextSecondary};
    }
  `,
}));

export const useAskCopilotItem = (editor: IEditor | undefined): ChatInputActionsProps['items'] => {
  const { t } = useTranslation('common');
  const addSelectionContext = useFileStore((s) => s.addChatContextSelection);
  const pageId = usePageEditorStore((s) => s.documentId);

  return useMemo(() => {
    if (!editor) return [];

    const label = t('cmdk.askLobeAI');

    return [
      {
        children: (
          <Block
            clickable
            horizontal
            align="center"
            className={styles.askCopilot}
            gap={8}
            paddingBlock={6}
            paddingInline={12}
            variant="borderless"
            onClick={() => {
              const xml = (editor.getSelectionDocument?.('litexml') as string) || '';
              const plainText = (editor.getSelectionDocument?.('text') as string) || '';
              const content = xml.trim() || plainText.trim();

              if (!content) return;

              const format = xml.trim() ? 'xml' : 'text';
              const preview =
                (plainText || xml)
                  .replaceAll(/<[^>]*>/g, ' ')
                  .replaceAll(/\s+/g, ' ')
                  .trim() || undefined;

              // Store action handles deduplication
              addSelectionContext({
                content,
                format,
                id: `selection-${nanoid(6)}`,
                pageId,
                preview,
                title: 'Selection',
                type: 'text',
              });

              // Open right panel if not opened
              useGlobalStore.getState().toggleRightPanel(true);

              // Focus on chat input after a short delay to ensure panel is opened
              setTimeout(() => {
                // Find the chat input editor within the right panel
                // Query all lexical editors and get the last one (which should be the chat input)
                const allEditors = [...document.querySelectorAll('[data-lexical-editor="true"]')];
                const chatInputEditor = allEditors.at(-1) as HTMLElement;
                if (chatInputEditor) {
                  chatInputEditor.focus();
                }
              }, 300);

              editor.dispatchCommand(HIDE_TOOLBAR_COMMAND, undefined);
              editor.blur();
            }}
          >
            <Avatar avatar={DEFAULT_INBOX_AVATAR} shape="square" size={16} />
            <span>{label}</span>
          </Block>
        ),
        key: 'ask-copilot',
        label,
        onClick: () => {},
      },
    ];
  }, [addSelectionContext, editor, pageId, t]);
};
