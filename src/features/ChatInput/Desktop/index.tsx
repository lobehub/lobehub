'use client';

import { type ChatInputProps } from '@lobehub/editor/react';
import { ChatInput, ChatInputActionBar } from '@lobehub/editor/react';
import { Center, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { type ReactNode } from 'react';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatInputStore } from '@/features/ChatInput/store';
import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';
import { fileChatSelectors, useFileStore } from '@/store/file';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { type ActionToolbarProps } from '../ActionBar';
import ActionBar from '../ActionBar';
import InputEditor from '../InputEditor';
import SendArea from '../SendArea';
import TypoBar from '../TypoBar';
import ContextContainer from './ContextContainer';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    .show-on-hover {
      opacity: 0;
    }

    &:hover {
      .show-on-hover {
        opacity: 1;
      }
    }
  `,
  footnote: css`
    font-size: 10px;
  `,
  fullscreen: css`
    position: absolute;
    z-index: 100;
    inset: 0;

    width: 100%;
    height: 100%;
    margin-block-start: 0;
  `,
  inputFullscreen: css`
    border: none;
    border-radius: 0 !important;
  `,
}));

interface DesktopChatInputProps extends ActionToolbarProps {
  extenHeaderContent?: ReactNode;
  inputContainerProps?: ChatInputProps;
  showFootnote?: boolean;
}

const DesktopChatInput = memo<DesktopChatInputProps>(
  ({
    showFootnote,
    inputContainerProps,
    extenHeaderContent,
    extraActionItems,
    dropdownPlacement,
  }) => {
    const { t } = useTranslation('chat');
    const [chatInputHeight, updateSystemStatus] = useGlobalStore((s) => [
      systemStatusSelectors.chatInputHeight(s),
      s.updateSystemStatus,
    ]);
    const hasContextSelections = useFileStore(fileChatSelectors.chatContextSelectionHasItem);
    const hasFiles = useFileStore(fileChatSelectors.chatUploadFileListHasItem);
    const [slashMenuRef, expand, showTypoBar, editor, leftActions] = useChatInputStore((s) => [
      s.slashMenuRef,
      s.expand,
      s.showTypoBar,
      s.editor,
      s.leftActions,
    ]);

    const chatKey = useChatStore(chatSelectors.currentChatKey);

    useEffect(() => {
      if (editor) editor.focus();
    }, [chatKey, editor]);

    const shouldShowContextContainer =
      leftActions.flat().includes('fileUpload') || hasContextSelections || hasFiles;
    const contextContainerNode = shouldShowContextContainer && <ContextContainer />;

    return (
      <Flexbox
        className={cx(styles.container, expand && styles.fullscreen)}
        gap={8}
        paddingBlock={expand ? 0 : showFootnote ? '0 12px' : '0 16px'}
      >
        <ChatInput
          data-testid="chat-input"
          defaultHeight={chatInputHeight || 32}
          fullscreen={expand}
          maxHeight={320}
          minHeight={36}
          resize={true}
          slashMenuRef={slashMenuRef}
          footer={
            <ChatInputActionBar
              right={<SendArea />}
              style={{ paddingRight: 8 }}
              left={
                <ActionBar
                  dropdownPlacement={dropdownPlacement}
                  extraActionItems={extraActionItems}
                />
              }
            />
          }
          header={
            <Flexbox gap={0}>
              {extenHeaderContent}
              {showTypoBar && <TypoBar />}
              {contextContainerNode}
            </Flexbox>
          }
          onSizeChange={(height) => {
            updateSystemStatus({ chatInputHeight: height });
          }}
          {...inputContainerProps}
          className={cx(expand && styles.inputFullscreen, inputContainerProps?.className)}
        >
          <InputEditor />
        </ChatInput>
        {showFootnote && !expand && (
          <Center style={{ pointerEvents: 'none', zIndex: 100 }}>
            <Text className={styles.footnote} type={'secondary'}>
              {t('input.disclaimer')}
            </Text>
          </Center>
        )}
      </Flexbox>
    );
  },
);

DesktopChatInput.displayName = 'DesktopChatInput';

export default DesktopChatInput;
