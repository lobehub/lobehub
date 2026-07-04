'use client';

import { type ChatInputProps } from '@lobehub/editor/react';
import { ChatInput, ChatInputActionBar } from '@lobehub/editor/react';
import { Center, Flexbox, Skeleton, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { type ReactNode, use } from 'react';
import { memo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import ChatInputNotice from '@/features/ChatInput/ChatInputNotice';
import { useChatInputStore } from '@/features/ChatInput/store';
import { LayoutContainerContext } from '@/routes/(main)/_layout/DesktopLayoutContainer/LayoutContainerContext';
import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';
import { fileChatSelectors, useFileStore } from '@/store/file';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { type ActionToolbarProps } from '../ActionBar';
import ActionBar from '../ActionBar';
import ControlBar from '../ControlBar';
import InputEditor from '../InputEditor';
import { useSkillDrop } from '../InputEditor/ActionTag/useSkillDrop';
import { type PlaceholderVariant } from '../InputEditor/Placeholder';
import { useWorkspaceFileDrop } from '../InputEditor/useWorkspaceFileDrop';
import SendArea from '../SendArea';
import TypoBar from '../TypoBar';
import ContextContainer from './ContextContainer';

const styles = createStaticStyles(({ css, cssVar }) => ({
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

    background: ${cssVar.colorBgContainer};
  `,
  inputFullscreen: css`
    border: none;
    border-radius: 0 !important;
  `,
}));

interface DesktopChatInputProps extends ActionToolbarProps {
  actionBarStyle?: React.CSSProperties;
  /**
   * Collapse the editor to a single bordered row by dropping the action bar footer.
   * Send still works through the Enter keybinding; the rest of the chrome
   * (control bar / footnote) is independently gated by `showControlBar` /
   * `showFootnote`. Defaults to false — other surfaces stay untouched.
   */
  compact?: boolean;
  /**
   * Custom node to render in place of the default ControlBar.
   * When provided, used instead of `<ControlBar />` (ignores `showControlBar`).
   */
  controlBarSlot?: ReactNode;
  extentHeaderContent?: ReactNode;
  hidden?: boolean;
  inputContainerProps?: ChatInputProps;
  /**
   * Swap the action bar and send area for skeleton placeholders while
   * the underlying agent / group / session config is still hydrating.
   * The editor itself stays usable. Wins over `leftContent` / `rightContent`.
   */
  isConfigLoading?: boolean;
  leftContent?: ReactNode;
  placeholder?: ReactNode;
  placeholderVariant?: PlaceholderVariant;
  rightContent?: ReactNode;
  sendAreaPrefix?: ReactNode;
  showControlBar?: boolean;
  showFootnote?: boolean;
}

const DesktopChatInput = memo<DesktopChatInputProps>(
  ({
    showFootnote,
    showControlBar = true,
    compact = false,
    controlBarSlot,
    inputContainerProps,
    extentHeaderContent,
    actionBarStyle,
    borderRadius,
    extraActionItems,
    dropdownPlacement,
    hidden,
    isConfigLoading = false,
    leftContent,
    placeholder,
    placeholderVariant,
    rightContent,
    sendAreaPrefix,
  }) => {
    const { t } = useTranslation('chat');
    const layoutContainerRef = use(LayoutContainerContext);
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

    const setExpand = useChatInputStore((s) => s.setExpand);
    const skillDrop = useSkillDrop();
    const workspaceFileDrop = useWorkspaceFileDrop();

    // Fan a single drag event out to every custom-MIME drop handler. Each one
    // no-ops unless its own MIME is present, so ordering is irrelevant.
    const handleDragOver = (event: React.DragEvent) => {
      skillDrop.onDragOver(event);
      workspaceFileDrop.onDragOver(event);
    };
    const handleDrop = (event: React.DragEvent) => {
      skillDrop.onDrop(event);
      workspaceFileDrop.onDrop(event);
    };

    useEffect(() => {
      if (editor) editor.focus();
      setExpand(false);
    }, [chatKey, editor, setExpand]);

    const shouldShowContextContainer =
      leftActions.flat().includes('fileUpload') || hasContextSelections || hasFiles;
    const contextContainerNode = shouldShowContextContainer && <ContextContainer />;

    const loadingLeftSlot = isConfigLoading ? (
      <Flexbox horizontal align="center" gap={6} paddingInline={4}>
        <Skeleton.Button active shape="circle" size="small" style={{ height: 28, width: 28 }} />
        <Skeleton.Button active shape="circle" size="small" style={{ height: 28, width: 28 }} />
      </Flexbox>
    ) : null;
    const loadingRightSlot = isConfigLoading ? (
      <Skeleton.Button
        active
        shape="round"
        size="small"
        style={{ height: 32, minWidth: 64, width: 64 }}
      />
    ) : null;

    const content = (
      <Flexbox
        className={cx(styles.container, expand && styles.fullscreen)}
        gap={8}
        paddingBlock={expand ? 0 : showFootnote ? '0 12px' : '0 8px'}
        style={{ display: hidden ? 'none' : undefined }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {!isConfigLoading && <ChatInputNotice />}
        <ChatInput
          data-testid="chat-input"
          defaultHeight={chatInputHeight || 32}
          fullscreen={expand}
          maxHeight={320}
          minHeight={36}
          resize={true}
          slashMenuRef={slashMenuRef}
          footer={
            compact ? undefined : (
              <ChatInputActionBar
                style={actionBarStyle ?? { paddingRight: 8 }}
                left={
                  loadingLeftSlot ??
                  leftContent ?? (
                    <ActionBar
                      borderRadius={borderRadius}
                      dropdownPlacement={dropdownPlacement}
                      extraActionItems={extraActionItems}
                    />
                  )
                }
                right={
                  loadingRightSlot ??
                  rightContent ??
                  (sendAreaPrefix ? (
                    <Flexbox horizontal align={'center'} gap={6}>
                      {sendAreaPrefix}
                      <SendArea />
                    </Flexbox>
                  ) : (
                    <SendArea />
                  ))
                }
              />
            )
          }
          header={
            <Flexbox gap={0}>
              {extentHeaderContent}
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
          <InputEditor placeholder={placeholder} placeholderVariant={placeholderVariant} />
        </ChatInput>
        {controlBarSlot ?? (showControlBar && <ControlBar />)}
        {showFootnote && !expand && (
          <Center style={{ pointerEvents: 'none', zIndex: 100 }}>
            <Text className={styles.footnote} type={'secondary'}>
              {t('input.disclaimer')}
            </Text>
          </Center>
        )}
      </Flexbox>
    );

    if (expand && layoutContainerRef.current)
      return createPortal(content, layoutContainerRef.current);

    return content;
  },
);

DesktopChatInput.displayName = 'DesktopChatInput';

export default DesktopChatInput;
