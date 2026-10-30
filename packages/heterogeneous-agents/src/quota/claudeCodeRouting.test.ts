import { describe, expect, it } from 'vitest';

import {
  claudeCodeAgentEnvPicksLogin,
  claudeCodeRoutesExternally,
  pickClaudeCodeLogin,
} from './claudeCodeRouting';

describe('claudeCodeRoutesExternally', () => {
  it.each([
    ['an enabled agent flag', { CLAUDE_CODE_USE_BEDROCK: '1' }, {}, true],
    ['an enabled inherited flag', {}, { CLAUDE_CODE_USE_VERTEX: 'true' }, true],
    [
      'an agent flag switching the inherited one off',
      { CLAUDE_CODE_USE_MANTLE: 'false' },
      { CLAUDE_CODE_USE_MANTLE: '1' },
      false,
    ],
    ['flags set to off', { CLAUDE_CODE_USE_BEDROCK: '0' }, { CLAUDE_CODE_USE_VERTEX: ' ' }, false],
    ['no flags', undefined, {}, false],
  ])('treats %s per the spawn-env merge', (_label, agentEnv, inherited, expected) => {
    expect(claudeCodeRoutesExternally(agentEnv, inherited)).toBe(expected);
  });
});

describe('pickClaudeCodeLogin', () => {
  const login = (externalAccountId: string, configDir: string | null = null) => ({
    configDir,
    identity: { externalAccountId },
  });
  const a = { externalAccountId: 'acc-a', name: 'a@example.com' };
  const b = { externalAccountId: 'acc-b', name: 'b@example.com' };

  it('runs a pin on its login, and never on another one', () => {
    const local = [login('acc-b'), login('acc-a', '/profiles/a')];

    expect(pickClaudeCodeLogin({ candidates: [a], mode: 'pinned' }, local)).toEqual({
      account: a,
      kind: 'login',
      login: local[1],
    });
    expect(pickClaudeCodeLogin({ candidates: [a], mode: 'pinned' }, [login('acc-b')])).toEqual({
      account: a,
      kind: 'pinned-missing',
    });
  });

  it('balances onto the best candidate this device holds, else keeps the default login', () => {
    const routing = { candidates: [a, b], mode: 'balanced' } as const;

    expect(pickClaudeCodeLogin(routing, [login('acc-b')])).toMatchObject({
      account: b,
      kind: 'login',
    });
    expect(pickClaudeCodeLogin(routing, [login('acc-b'), login('acc-a', '/p/a')])).toMatchObject({
      account: a,
    });
    expect(pickClaudeCodeLogin(routing, [login('acc-c')])).toEqual({ kind: 'default' });
  });
});

describe('claudeCodeAgentEnvPicksLogin', () => {
  it('treats a login, credential or external-provider env as the agent choosing', () => {
    expect(claudeCodeAgentEnvPicksLogin(undefined)).toBe(false);
    expect(claudeCodeAgentEnvPicksLogin({ CLAUDE_CONFIG_DIR: ' ' })).toBe(false);
    expect(claudeCodeAgentEnvPicksLogin({ CLAUDE_CONFIG_DIR: '/x' })).toBe(true);
    expect(claudeCodeAgentEnvPicksLogin({ ANTHROPIC_API_KEY: 'sk' })).toBe(true);
    expect(claudeCodeAgentEnvPicksLogin({ CLAUDE_CODE_USE_BEDROCK: '1' })).toBe(true);
  });
});
