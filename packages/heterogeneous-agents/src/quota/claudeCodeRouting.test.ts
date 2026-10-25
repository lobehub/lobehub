import { describe, expect, it } from 'vitest';

import { claudeCodeRoutesExternally } from './claudeCodeRouting';

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
