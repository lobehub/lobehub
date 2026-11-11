import { INBOX_SESSION_ID } from '@lobechat/const';
import { afterEach, describe, expect, it } from 'vitest';

import { useAgentStore } from '@/store/agent';

import HomeAgentIdSync from './HomeAgentIdSync.desktop';

afterEach(() => {
  useAgentStore.setState({ activeAgentId: undefined, builtinAgentIdMap: {} });
});

describe('HomeAgentIdSync (desktop)', () => {
  it('does not touch the active agent when the hidden home tab re-renders', () => {
    useAgentStore.setState({
      activeAgentId: 'agent-cc',
      builtinAgentIdMap: { [INBOX_SESSION_ID]: 'inbox' },
    });

    // Keep-alive tabs re-run the home layout after the active tab has been
    // projected; the desktop twin must leave that projection alone.
    expect(HomeAgentIdSync()).toBeNull();
    expect(useAgentStore.getState().activeAgentId).toBe('agent-cc');
  });
});
