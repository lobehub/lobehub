import { describe, expect, it } from 'vitest';

import { commandLineLooksLikeHeteroCli } from './heteroCliProcess';

describe('commandLineLooksLikeHeteroCli', () => {
  it('matches the recorded command basename anywhere on the command line', () => {
    expect(
      commandLineLooksLikeHeteroCli(
        'node /Users/me/.npm/bin/claude -p --output-format stream-json',
        { agentType: 'claude-code', command: 'claude' },
      ),
    ).toBe(true);
  });

  it('falls back to the agent type when no command was recorded', () => {
    expect(commandLineLooksLikeHeteroCli('/opt/codex exec --json', { agentType: 'codex' })).toBe(
      true,
    );
  });

  it('rejects an unrelated process that recycled the pid', () => {
    expect(
      commandLineLooksLikeHeteroCli('/Applications/Safari.app/Contents/MacOS/Safari', {
        agentType: 'claude-code',
        command: 'claude',
      }),
    ).toBe(false);
    expect(commandLineLooksLikeHeteroCli(undefined, { agentType: 'claude-code' })).toBe(false);
  });
});
