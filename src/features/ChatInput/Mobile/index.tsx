'use client';

import { ChatInput, ChatInputActionBar } from '@lobehub/editor/react';
import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import ChatInputNotice from '@/features/ChatInput/ChatInputNotice';
import ComposerExpandButton from '@/features/ChatInput/components/ComposerExpandButton';
import { useChatInputStore } from '@/features/ChatInput/store';
import dynamic from '@/libs/next/dynamic';

import ActionBar from '../ActionBar';
import InputEditor from '../InputEditor';
import SendArea from '../SendArea';
import moduleStyles from './index.module.css';

const FilePreview = dynamic(() => import('./FilePreview'), { ssr: false });

const styles = stylex.create({
  fullscreen: {
    position: 'absolute',
    zIndex: 100,
    inset: 0,
    width: '100%',
    height: '100%',
    padding: '12px',
    backgroundColor: cssVar.colorBgLayout,
    backgroundImage: 'none',
  },
  leftSlot: { overflow: 'hidden', flex: '1', minWidth: '0' },
});

const DesktopChatInput = memo(() => {
  const [slashMenuRef, expand] = useChatInputStore((s) => [s.slashMenuRef, s.expand]);
  const leftActions = useChatInputStore((s) => s.leftActions);

  const fileNode = leftActions.flat().includes('fileUpload') && <FilePreview />;

  return (
    <>
      {!expand && fileNode}
      <Flexbox
        className={stylex.props(expand && styles.fullscreen).className}
        gap={8}
        paddingBlock={'0 12px'}
        paddingInline={12}
      >
        <ChatInput
          fullscreen={expand}
          slashMenuRef={slashMenuRef}
          footer={
            <ChatInputActionBar
              left={<div />}
              right={<SendArea hideContextWindow={false} />}
              style={{
                paddingRight: 8,
              }}
            />
          }
          header={
            <ChatInputActionBar
              left={
                <Flexbox
                  horizontal
                  align={'center'}
                  className={stylex.props(styles.leftSlot).className}
                  gap={4}
                >
                  <Flexbox horizontal align={'center'} flex={'none'} gap={2}>
                    <Flexbox horizontal align={'center'} className={moduleStyles.leftActions}>
                      <ActionBar disableCollapse />
                    </Flexbox>
                    <ComposerExpandButton />
                  </Flexbox>
                  <ChatInputNotice />
                </Flexbox>
              }
            />
          }
        >
          {expand && fileNode}
          <InputEditor defaultRows={1} />
        </ChatInput>
      </Flexbox>
    </>
  );
});

DesktopChatInput.displayName = 'DesktopChatInput';

export default DesktopChatInput;
