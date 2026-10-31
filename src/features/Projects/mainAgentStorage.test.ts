import { afterEach, describe, expect, it } from 'vitest';

import {
  readRememberedMainAgent,
  resolveDefaultMainAgent,
  writeRememberedMainAgent,
} from './mainAgentStorage';

describe('mainAgentStorage', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('remembers the main agent separately per workspace', () => {
    writeRememberedMainAgent('agt_personal');
    writeRememberedMainAgent('agt_team', 'ws_1');

    expect(readRememberedMainAgent()).toBe('agt_personal');
    expect(readRememberedMainAgent('ws_1')).toBe('agt_team');
    expect(readRememberedMainAgent('ws_2')).toBeUndefined();
  });

  it('defaults to LobeAI when nothing is remembered', () => {
    expect(
      resolveDefaultMainAgent({ agentExists: () => true, inboxAgentId: 'inbox', listLoaded: true }),
    ).toBe('inbox');
  });

  it('reuses a remembered agent that still exists', () => {
    expect(
      resolveDefaultMainAgent({
        agentExists: (id) => id === 'agt_1',
        inboxAgentId: 'inbox',
        listLoaded: true,
        remembered: 'agt_1',
      }),
    ).toBe('agt_1');
  });

  it('falls back to LobeAI once the list shows the remembered agent is gone', () => {
    const input = {
      agentExists: () => false,
      inboxAgentId: 'inbox',
      remembered: 'agt_deleted',
    };

    expect(resolveDefaultMainAgent({ ...input, listLoaded: false })).toBe('agt_deleted');
    expect(resolveDefaultMainAgent({ ...input, listLoaded: true })).toBe('inbox');
  });
});
