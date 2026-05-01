import { memo, useEffect, useState } from 'react';

import { Fab } from './Fab';
import { Modal } from './Modal';
import { Popover } from './Popover';

const isDevEnv = process.env.NODE_ENV === 'development';
const STORAGE_KEY = 'LOBE_AGENT_MOCK_ENABLED';

const useDevtoolsEnabled = (): boolean => {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!isDevEnv) return;
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

const AgentMockDevtools = memo(() => {
  const enabled = useDevtoolsEnabled();
  if (!isDevEnv || !enabled) return null;
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
