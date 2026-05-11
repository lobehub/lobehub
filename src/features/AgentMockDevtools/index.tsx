import { memo, useEffect, useState } from 'react';
import { useMatches } from 'react-router-dom';

import { Fab } from './Fab';
import { Modal } from './Modal';
import { Popover } from './Popover';

const STORAGE_KEY = 'LOBE_AGENT_MOCK_ENABLED';

const useDevtoolsEnabled = (): boolean => {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!__DEV__) return;
    setEnabled(localStorage.getItem(STORAGE_KEY) === '1');
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setEnabled(e.newValue === '1');
    };
    window.addEventListener('storage', onStorage);
    if (!localStorage.getItem(STORAGE_KEY)) {
      console.info(
        '[AgentMock] Dev tool available. Enable with: localStorage.LOBE_AGENT_MOCK_ENABLED = "1"',
      );
    }
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  return enabled;
};

const useIsAgentTopicRoute = (): boolean => {
  const matches = useMatches();
  // Check if any resolved route segment has a topicId param
  // This correctly distinguishes /agent/:topicId from /agent/page, /agent/profile, etc.
  return matches.some((m) => 'topicId' in m.params);
};

const AgentMockDevtools = memo(() => {
  const enabled = useDevtoolsEnabled();
  const isAgentTopicRoute = useIsAgentTopicRoute();
  if (!__DEV__ || !enabled || !isAgentTopicRoute) return null;
  return (
    <>
      <Fab />
      <Popover />
      <Modal />
    </>
  );
});

AgentMockDevtools.displayName = 'AgentMockDevtools';

export default AgentMockDevtools;
