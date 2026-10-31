'use client';

import { type ChatInputProps } from '@lobehub/editor/react';
import { ChatInput, ChatInputActionBar } from '@lobehub/editor/react';
import { Center, cx, Flexbox, Skeleton, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode, use } from 'react';
import { memo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import ChatInputNotice from '@/features/ChatInput/ChatInputNotice';
import ComposerExpandButton from '@/features/ChatInput/components/ComposerExpandButton';
import { useChatInputStore } from '@/features/ChatInput/store';
import { LayoutContainerContext } from '@/features/DesktopLayoutContainer/LayoutContainerContext';
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
import { useTopicDrop } from '../InputEditor/ReferTopic/useTopicDrop';
import { useWorkspaceFileDrop } from '../InputEditor/useWorkspaceFileDrop';
import SendArea from '../SendArea';
import TypoBar from '../TypoBar';
import ContextContainer from './ContextContainer';
import moduleStyles from './index.module.css';

const styles = stylex.create({
  footnote: { fontSize: '10px' },
  fullscreen: {
    position: 'absolute',
    zIndex: 100,
    inset: 0,
    width: '100%',
    height: '100%',
    marginBlockStart: '0',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  // Longhand corners: they outrank the editor's own `border-radius` shorthand, which
  // the emotion version had to beat with `!important`.
  inputFullscreen: {
    borderStyle: 'none',
    borderStartStartRadius: 0,
    borderStartEndRadius: 0,
    borderEndStartRadius: 0,
    borderEndEndRadius: 0,
  },
  leftSlot: { overflow: 'hidden', flex: '1', minWidth: '0' },
});

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
  initialContent?: string;
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
    initialContent,
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
    const contextSelectionKey = useChatInputStore((s) => s.contextSelectionKey);
    const hasContextSelections = useFileStore(
      fileChatSelectors.chatContextSelectionHasItem(contextSelectionKey),
    );
    const hasFiles = useFileStore(fileChatSelectors.chatUploadFileListHasItem);
    const [slashMenuRef, expand, showTypoBar, editor, leftActions] = useChatInputStore((s) => [
      s.slashMenuRef,
      s.expand,
      s.showTypoBar,
      s.editor,
      s.leftActions,
    ]);

    const chatKey = useChatStore(chatSelectors.currentChatKey);

    // The ControlBar (or the custom slot standing in for it) hosts the
    // context-window token tag; without one, SendArea keeps it beside Send.
    const hasControlBar = Boolean(controlBarSlot) || showControlBar;

    const setExpand = useChatInputStore((s) => s.setExpand);
    const skillDrop = useSkillDrop();
    const topicDrop = useTopicDrop();
    const workspaceFileDrop = useWorkspaceFileDrop();

    // Fan a single drag event out to every custom-MIME drop handler. Each one
    // no-ops unless its own MIME is present, so ordering is irrelevant.
    const handleDragOver = (event: React.DragEvent) => {
      skillDrop.onDragOver(event);
      topicDrop.onDragOver(event);
      workspaceFileDrop.onDragOver(event);
    };
    const handleDrop = (event: React.DragEvent) => {
      skillDrop.onDrop(event);
      topicDrop.onDrop(event);
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
        <Skeleton height={28} radius={'50%'} width={28} />
        <Skeleton height={28} radius={'50%'} width={28} />
      </Flexbox>
    ) : null;
    const loadingRightSlot = isConfigLoading ? (
      <Skeleton radius={999} style={{ height: 32, minWidth: 64, width: 64 }} />
    ) : null;
    const noticeNode = !isConfigLoading && <ChatInputNotice />;
    // The action bar is `width: 100%`, so a sibling placed *inside* its
    // shrink-to-fit box is pushed past the bar's right edge and leaves a
    // one-slot hole between the last action and the expand toggle. Keep the
    // toggle in a row outside that box.
    // NOTICE: The hover-only expand button stays in layout at zero opacity to
    // prevent shifting. Keep the notice before it so the hidden 32px control
    // does not create a false gap after the microphone action.
    const leftSlotContent = (
      <Flexbox horizontal align={'center'} flex={'none'} gap={2}>
        <Flexbox horizontal align={'center'} className={moduleStyles.leftActions}>
          {leftContent ?? (
            <ActionBar
              disableCollapse
              borderRadius={borderRadius}
              dropdownPlacement={dropdownPlacement}
              extraActionItems={extraActionItems}
            />
          )}
        </Flexbox>
        {noticeNode}
        <ComposerExpandButton />
      </Flexbox>
    );
    const leftSlot = noticeNode ? (
      <Flexbox horizontal align={'center'} className={stylex.props(styles.leftSlot).className}>
        {leftSlotContent}
      </Flexbox>
    ) : (
      leftSlotContent
    );

    const content = (
      <Flexbox
        className={cx(moduleStyles.container, stylex.props(expand && styles.fullscreen).className)}
        gap={8}
        paddingBlock={expand ? 0 : showFootnote ? '0 12px' : '0 8px'}
        style={{ display: hidden ? 'none' : undefined }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
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
            compact ? undefined : (
              <ChatInputActionBar
                left={loadingLeftSlot ?? leftSlot}
                style={actionBarStyle ?? { paddingRight: 8 }}
                right={
                  loadingRightSlot ??
                  rightContent ??
                  (sendAreaPrefix ? (
                    <Flexbox horizontal align={'center'} gap={6}>
                      {sendAreaPrefix}
                      <SendArea hideContextWindow={hasControlBar} />
                    </Flexbox>
                  ) : (
                    <SendArea hideContextWindow={hasControlBar} />
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
          className={cx(
            stylex.props(expand && styles.inputFullscreen).className,
            inputContainerProps?.className,
          )}
        >
          <InputEditor
            initialContent={initialContent}
            placeholder={placeholder}
            placeholderVariant={placeholderVariant}
          />
        </ChatInput>
        {controlBarSlot ?? (showControlBar && <ControlBar />)}
        {showFootnote && !expand && (
          <Center style={{ pointerEvents: 'none', zIndex: 100 }}>
            <Text className={stylex.props(styles.footnote).className} type={'secondary'}>
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
