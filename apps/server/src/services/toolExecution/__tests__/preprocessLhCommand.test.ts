import { describe, expect, it, vi } from 'vitest';

import { buildDeviceLhEnv, isLhCommand, preprocessLhCommand } from '../preprocessLhCommand';

const mockSignUserJWT = vi.hoisted(() => vi.fn().mockResolvedValue('mock-jwt-token'));

vi.mock('@/libs/trpc/utils/internalJwt', () => ({
  signUserJWT: mockSignUserJWT,
}));

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://app.lobehub.com' },
}));

vi.mock('@/utils/env', () => ({
  isDev: false,
}));

const EXPORT_LINE = "export LOBEHUB_JWT='mock-jwt-token' LOBEHUB_SERVER='https://app.lobehub.com'";
const FN_LINE = 'lh() { npx -y @lobehub/cli "$@"; }';

describe('preprocessLhCommand', () => {
  it('should return unchanged command for non-lh commands', async () => {
    const result = await preprocessLhCommand('echo hello', 'user-1');

    expect(result.isLhCommand).toBe(false);
    expect(result.skipSkillLookup).toBe(false);
    expect(result.command).toBe('echo hello');
  });

  it('should prepend the auth prelude and keep the command verbatim', async () => {
    const result = await preprocessLhCommand('lh topic list --json', 'user-1');

    expect(result.isLhCommand).toBe(true);
    expect(result.skipSkillLookup).toBe(true);
    expect(result.command).toBe(`${EXPORT_LINE}\n${FN_LINE}\nlh topic list --json`);
  });

  it('should inject workspace scope for lh commands from workspace runs', async () => {
    const result = await preprocessLhCommand('lh agent view agt_123', 'user-1', 'workspace-1');

    expect(result.command).toBe(
      `${EXPORT_LINE} LOBEHUB_WORKSPACE_ID='workspace-1'\n${FN_LINE}\nlh agent view agt_123`,
    );
  });

  it('should emit the JWT once regardless of how many lh calls the script makes', async () => {
    const cmd = 'lh topic list --page 1 && lh topic list --page 2 && echo "done"';
    const result = await preprocessLhCommand(cmd, 'user-1');

    expect(result.command).toBe(`${EXPORT_LINE}\n${FN_LINE}\n${cmd}`);
    expect(result.command.match(/mock-jwt-token/g)).toHaveLength(1);
  });

  it('should shell-escape values containing quotes', async () => {
    mockSignUserJWT.mockResolvedValueOnce("jwt-with-'quote");

    const result = await preprocessLhCommand('lh topic list', 'user-1');

    expect(result.command).toContain(String.raw`LOBEHUB_JWT='jwt-with-'\''quote'`);
  });

  it('should return error when JWT signing fails', async () => {
    mockSignUserJWT.mockRejectedValueOnce(new Error('sign failed'));

    const result = await preprocessLhCommand('lh topic list', 'user-1');

    expect(result.isLhCommand).toBe(true);
    expect(result.error).toBe('Failed to authenticate for CLI execution');
    expect(result.command).toBe('lh topic list');
  });
});

describe('isLhCommand', () => {
  // Every form below used to fall through the old
  // `/(?:^|&&|\|\||;)\s*lh(?:\s|$)/` pattern, leaving `lh` unresolved in the
  // sandbox. The multi-line one is the regression that broke self-editing:
  // "view yourself, then edit yourself" is naturally written as two lines.
  it.each([
    ['bare', 'lh'],
    ['leading whitespace', '  lh agent list'],
    ['after &&', 'cd /tmp && lh agent view agt_1'],
    ['after ||', 'lh agent view agt_1 || lh agent list'],
    ['after ;', 'lh a; lh b'],
    ['second line of a script', 'lh agent view agt_1 --json\nlh agent edit agt_1 -t x'],
    ['piped', 'lh agent view agt_1 --json | jq .title'],
    ['command substitution', 'echo $(lh agent view agt_1 --json)'],
    ['backticks', 'echo `lh agent list`'],
    ['subshell', '(lh agent view agt_1)'],
    ['brace group', '{ lh agent list; }'],
    ['loop body', 'for i in 1 2; do lh agent list; done'],
    ['if condition', 'if lh agent view agt_1; then echo ok; fi'],
    ['inline env assignment', 'LOBEHUB_WORKSPACE_ID=ws lh agent list'],
    ['quoted inline assignment', 'FOO="a b" lh agent list'],
  ])('detects %s', (_label, command) => {
    expect(isLhCommand(command)).toBe(true);
  });

  it.each([
    ['plain command', 'echo hello'],
    ['substring of a word', 'echoalhough'],
    ['npm script name', 'npm run lhtest'],
    ['a local script of the same name', './lh agent list'],
    ['a path segment', 'ls /opt/lh'],
  ])('does not detect %s', (_label, command) => {
    expect(isLhCommand(command)).toBe(false);
  });
});

describe('buildDeviceLhEnv', () => {
  it('scopes an lh command to the run workspace', () => {
    expect(buildDeviceLhEnv('lh agent edit agt_1 -t x', 'ws-1')).toEqual({
      LOBEHUB_WORKSPACE_ID: 'ws-1',
    });
  });

  it('never ships the caller JWT onto the device', () => {
    expect(buildDeviceLhEnv('lh agent list', 'ws-1')).not.toHaveProperty('LOBEHUB_JWT');
  });

  it('returns undefined for personal runs', () => {
    expect(buildDeviceLhEnv('lh agent list', undefined)).toBeUndefined();
  });

  it('returns undefined for non-lh commands', () => {
    expect(buildDeviceLhEnv('ls -la', 'ws-1')).toBeUndefined();
  });
});
