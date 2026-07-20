'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { Outlet } from 'react-router';

import ChatTerminalPanel from '@/features/ChatTerminal';
import ChatHeader from '@/routes/(main)/agent/features/Conversation/Header';
import AgentWorkingSidebar from '@/routes/(main)/agent/features/Conversation/WorkingSidebar';
import Portal from '@/routes/(main)/agent/features/Portal';

import HeaderSlot from './HeaderSlot';

const styles = createStaticStyles(({ css }) => ({
  // Named container queried by ChatHeader and the list top spacer: when this
  // column is wide enough, the header floats above the full-bleed message
  // stream instead of sitting in flow as a solid bar.
  conversationColumn: css`
    position: relative;
    container-name: agent-chat-layout;
    container-type: inline-size;
  `,
}));

const ChatLayout = memo(() => {
  return (
    <HeaderSlot.Provider>
      <Flexbox flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }} width={'100%'}>
        <Flexbox
          horizontal
          flex={1}
          style={{ minHeight: 0, overflow: 'hidden', position: 'relative' }}
          width={'100%'}
        >
          <Flexbox
            className={styles.conversationColumn}
            flex={1}
            style={{ minHeight: 0, minWidth: 0 }}
          >
            <ChatHeader />
            <Flexbox flex={1} style={{ minHeight: 0, position: 'relative' }}>
              <Outlet />
            </Flexbox>
          </Flexbox>
          <Portal />
          <AgentWorkingSidebar />
        </Flexbox>
        <ChatTerminalPanel />
      </Flexbox>
    </HeaderSlot.Provider>
  );
});

ChatLayout.displayName = 'ChatLayout';

export default ChatLayout;
