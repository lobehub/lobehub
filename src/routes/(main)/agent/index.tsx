'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import MainInterfaceTracker from '@/components/Analytics/MainInterfaceTracker';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import Conversation from './features/Conversation';
import AgentWorkingSidebar from './features/Conversation/WorkingSidebar';
import PageTitle from './features/PageTitle';
import Portal from './features/Portal';
import TelemetryNotification from './features/TelemetryNotification';

const ChatPage = memo(() => {
  const enableAgentWorkingPanel = useUserStore(labPreferSelectors.enableAgentWorkingPanel);

  return (
    <>
      <PageTitle />
      <Flexbox
        horizontal
        height={'100%'}
        style={{ overflow: 'hidden', position: 'relative' }}
        width={'100%'}
      >
        <Conversation />
        <Portal />
        {/* TODO: Remove this labs-only mount gate once Working Panel is no longer experimental.
            See the matching TODO in `src/hooks/useHotkeys/globalScope.ts`. */}
        {enableAgentWorkingPanel && <AgentWorkingSidebar />}
      </Flexbox>
      <MainInterfaceTracker />
      <TelemetryNotification mobile={false} />
    </>
  );
});

export default ChatPage;
