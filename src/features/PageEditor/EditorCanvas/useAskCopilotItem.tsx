'use client';

import { nanoid } from '@lobechat/utils';
import { HIDE_TOOLBAR_COMMAND, type IEditor } from '@lobehub/editor';
import { type ChatInputActionsProps } from '@lobehub/editor/react';
import { Block } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { BotIcon } from 'lucide-react';
import { useMemo } from 'react';

import { useFileStore } from '@/store/file';
import { useGlobalStore } from '@/store/global';

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
  const addSelectionContext = useFileStore((s) => s.addChatContextSelection);

  return useMemo(() => {
    if (!editor) return [];

    return [
      {
        children: (
          <Block
            align="center"
            className={styles.askCopilot}
            clickable
            gap={8}
            horizontal
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
            paddingBlock={6}
            paddingInline={12}
            variant="borderless"
          >
            <BotIcon />
            <span>Ask Copilot</span>
          </Block>
        ),
        key: 'ask-copilot',
        label: 'Ask Copilot',
        onClick: () => {},
      },
    ];
  }, [addSelectionContext, editor]);
};
