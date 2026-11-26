import { describe, expect, it } from 'vitest';

import { buildAntigravityAcpLaunch } from './antigravity';

describe('buildAntigravityAcpLaunch', () => {
  it('runs the ACP server with auto-approved tools and moves selectors into the session', () => {
    expect(
      buildAntigravityAcpLaunch([
        '--model',
        'gemini-4-neon-xhigh',
        '--effort=high',
        '--mode',
        'plan',
        '--add-dir',
        '/repo/shared',
      ]),
    ).toEqual({
      args: ['acp', '--dangerously-skip-permissions', '--add-dir', '/repo/shared'],
      effort: 'high',
      mode: 'plan',
      model: 'gemini-4-neon-xhigh',
    });
    expect(buildAntigravityAcpLaunch()).toEqual({
      args: ['acp', '--dangerously-skip-permissions'],
    });
  });

  it('does not repeat a user-supplied --dangerously-skip-permissions', () => {
    expect(buildAntigravityAcpLaunch(['--dangerously-skip-permissions']).args).toEqual([
      'acp',
      '--dangerously-skip-permissions',
    ]);
  });

  it.each([
    '--output-format=json',
    '--input-format',
    '--prompt-interactive=hello',
    '--remote-control',
    '--settings={}',
    '-i',
    '-p',
    '--continue',
    '--conversation=other',
    '--',
  ])('rejects %s, which LobeHub owns over ACP', (flag) => {
    expect(() => buildAntigravityAcpLaunch([flag])).toThrow('LobeHub manages');
  });

  it('rejects a selector flag without a value', () => {
    expect(() => buildAntigravityAcpLaunch(['--model'])).toThrow('needs a value');
  });
});
