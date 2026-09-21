import { describe, expect, it, vi } from 'vitest';

import {
  commandLineLooksLikeHeteroCli,
  isProcessAlive,
  waitForProcessExit,
} from './heteroCliProcess';

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

describe('isProcessAlive', () => {
  it('reports the current process alive and a dead pid gone', () => {
    // Own pid is not a group leader; use the platform-specific target of its own group.
    expect(isProcessAlive(process.pid, 'win32')).toBe(true);
    expect(isProcessAlive(2_147_483_000, 'win32')).toBe(false);
  });
});

describe('waitForProcessExit', () => {
  it('resolves true as soon as the process is gone', async () => {
    let polls = 0;
    const isAlive = vi.fn(() => ++polls < 3);

    await expect(waitForProcessExit(1, 1000, { isAlive, pollMs: 1 })).resolves.toBe(true);
    expect(isAlive).toHaveBeenCalledTimes(3);
  });

  it('resolves false when the process outlives the timeout', async () => {
    await expect(waitForProcessExit(1, 20, { isAlive: () => true, pollMs: 1 })).resolves.toBe(
      false,
    );
  });
});
