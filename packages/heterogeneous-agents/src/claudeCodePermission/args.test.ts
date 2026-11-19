import { describe, expect, it } from 'vitest';

import { buildClaudeCodePermissionArgs, resolveClaudeCodePermissionMode } from './args';

describe('buildClaudeCodePermissionArgs', () => {
  it('keeps every action allowed when the lab picked no mode', () => {
    expect(buildClaudeCodePermissionArgs({ isRoot: false })).toEqual([
      '--permission-mode',
      'bypassPermissions',
    ]);
    expect(buildClaudeCodePermissionArgs({ isRoot: true })).toEqual([
      '--permission-mode',
      'acceptEdits',
      '--allowed-tools',
      'Bash,Read,Write,Edit,MultiEdit,WebSearch,mcp__*',
    ]);
  });

  it.each(['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions'] as const)(
    'starts in %s, asks over stdio and permits a later switch to bypass',
    (mode) => {
      expect(buildClaudeCodePermissionArgs({ isRoot: false, mode })).toEqual([
        '--permission-mode',
        mode,
        '--permission-prompt-tool',
        'stdio',
        '--allow-dangerously-skip-permissions',
      ]);
    },
  );

  it('falls back to plain acceptEdits for bypass as root, pre-approving nothing', () => {
    // An allow rule would outlive a later switch to a stricter mode.
    expect(buildClaudeCodePermissionArgs({ isRoot: true, mode: 'bypassPermissions' })).toEqual([
      '--permission-mode',
      'acceptEdits',
      '--permission-prompt-tool',
      'stdio',
    ]);
  });

  it('never permits skipping permissions as root', () => {
    expect(buildClaudeCodePermissionArgs({ isRoot: true, mode: 'plan' })).toEqual([
      '--permission-mode',
      'plan',
      '--permission-prompt-tool',
      'stdio',
    ]);
  });
});

describe('buildClaudeCodePermissionArgs — no host to answer', () => {
  it('keeps a restrictive mode and lets print mode deny, never bypassing', () => {
    for (const mode of ['default', 'acceptEdits', 'auto', 'plan'] as const) {
      expect(buildClaudeCodePermissionArgs({ hostPrompts: false, isRoot: false, mode })).toEqual([
        '--permission-mode',
        mode,
      ]);
    }
    expect(
      buildClaudeCodePermissionArgs({
        hostPrompts: false,
        isRoot: true,
        mode: 'bypassPermissions',
      }),
    ).toEqual(['--permission-mode', 'acceptEdits']);
  });
});

describe('resolveClaudeCodePermissionMode', () => {
  it('reports the root fallback only for bypass', () => {
    expect(resolveClaudeCodePermissionMode('bypassPermissions', true)).toEqual({
      fallback: 'root',
      mode: 'acceptEdits',
    });
    expect(resolveClaudeCodePermissionMode('plan', true)).toEqual({ mode: 'plan' });
    expect(resolveClaudeCodePermissionMode('bypassPermissions', false)).toEqual({
      mode: 'bypassPermissions',
    });
  });
});
