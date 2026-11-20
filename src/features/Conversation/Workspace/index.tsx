'use client';

import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useSize } from 'ahooks';
import { type ReactNode, useRef } from 'react';

import ChatTerminalPanel from '@/features/ChatTerminal';
import AgentWorkingSidebar from '@/features/Conversation/WorkingSidebar';
import OverviewSlot from '@/features/Conversation/WorkingSidebar/OverviewSlot';
import HeaderSlot from '@/routes/(main)/agent/(chat)/_layout/HeaderSlot';
import Portal from '@/routes/(main)/agent/features/Portal';

const styles = stylex.create({
  conversationColumn: {
    position: 'relative',
    containerName: 'agent-chat-layout',
    containerType: 'inline-size',
  },
});

const ConversationWorkspace = ({
  children,
  header,
}: {
  children: ReactNode;
  header: ReactNode;
}) => {
  // The working sidebar needs the row width to know whether it still fits next
  // to an open portal — a wide portal otherwise squeezes the conversation out.
  const rowRef = useRef<HTMLDivElement>(null);
  const rowSize = useSize(rowRef);

  return (
    <HeaderSlot.Provider>
      <OverviewSlot.Provider>
        <Flexbox
          flex={1}
          height={'100%'}
          style={{ minHeight: 0, overflow: 'hidden' }}
          width={'100%'}
        >
          <Flexbox
            horizontal
            flex={1}
            ref={rowRef}
            style={{ minHeight: 0, overflow: 'hidden', position: 'relative' }}
            width={'100%'}
          >
            <Flexbox
              className={stylex.props(styles.conversationColumn).className}
              flex={1}
              style={{ minHeight: 0, minWidth: 0 }}
            >
              {header}
              <Flexbox horizontal flex={1} style={{ minHeight: 0, minWidth: 0 }}>
                <Flexbox flex={1} style={{ minHeight: 0, minWidth: 0 }}>
                  {children}
                </Flexbox>
                <OverviewSlot.Outlet />
              </Flexbox>
            </Flexbox>
            <Portal />
            <AgentWorkingSidebar availableWidth={rowSize?.width} />
          </Flexbox>
          <ChatTerminalPanel />
        </Flexbox>
      </OverviewSlot.Provider>
    </HeaderSlot.Provider>
  );
};

export default ConversationWorkspace;
