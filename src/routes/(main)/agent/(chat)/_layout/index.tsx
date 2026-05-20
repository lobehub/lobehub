'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { Outlet } from 'react-router-dom';

import ChatHeader from '@/routes/(main)/agent/features/Conversation/Header';
import AgentWorkingSidebar from '@/routes/(main)/agent/features/Conversation/WorkingSidebar';
import Portal from '@/routes/(main)/agent/features/Portal';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import HeaderSlot from './HeaderSlot';

const ChatLayout = memo(() => {
  const showHeader = useGlobalStore(systemStatusSelectors.showChatHeader);

  return (
    <HeaderSlot.Provider>
      <Flexbox
        horizontal
        flex={1}
        height={'100%'}
        style={{ minHeight: 0, overflow: 'hidden', position: 'relative' }}
        width={'100%'}
      >
        <Flexbox flex={1} style={{ minHeight: 0, minWidth: 0 }}>
          {showHeader && <ChatHeader />}
          <Flexbox flex={1} style={{ minHeight: 0, position: 'relative' }}>
            <Outlet />
          </Flexbox>
        </Flexbox>
        <Portal />
        <AgentWorkingSidebar />
      </Flexbox>
    </HeaderSlot.Provider>
  );
});

ChatLayout.displayName = 'ChatLayout';

export default ChatLayout;
