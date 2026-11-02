import { afterEach, describe, expect, it } from 'vitest';

import {
  DEDICATED_MAIN_AGENT,
  readRememberedMainAgent,
  resolveDefaultMainAgent,
  resolveDefaultMainAgentMode,
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

  it('reopens in the mode the last project was created with', () => {
    expect(resolveDefaultMainAgentMode()).toBe('existing');
    expect(resolveDefaultMainAgentMode('agt_1')).toBe('existing');
    expect(resolveDefaultMainAgentMode(DEDICATED_MAIN_AGENT)).toBe('dedicated');
  });

  it('never treats the dedicated marker as an agent id', () => {
    for (const listLoaded of [false, true]) {
      expect(
        resolveDefaultMainAgent({
          agentExists: () => true,
          inboxAgentId: 'inbox',
          listLoaded,
          remembered: DEDICATED_MAIN_AGENT,
        }),
      ).toBe('inbox');
    }
  });
});
