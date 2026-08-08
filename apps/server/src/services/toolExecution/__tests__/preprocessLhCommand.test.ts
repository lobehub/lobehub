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

const CREDS = "LOBEHUB_JWT='mock-jwt-token' LOBEHUB_SERVER='https://app.lobehub.com'";
/** The shim, with credentials scoped to the `npx` process rather than exported. */
const shim = (extraEnv = '') => `lh() { ${CREDS}${extraEnv} npx -y @lobehub/cli "$@"; }`;

describe('preprocessLhCommand', () => {
  it('should return unchanged command for non-lh commands', async () => {
    const result = await preprocessLhCommand('echo hello', 'user-1');

    expect(result.isLhCommand).toBe(false);
    expect(result.skipSkillLookup).toBe(false);
    expect(result.command).toBe('echo hello');
  });

  it('should prepend the auth shim and keep the command verbatim', async () => {
    const result = await preprocessLhCommand('lh topic list --json', 'user-1');

    expect(result.isLhCommand).toBe(true);
    expect(result.skipSkillLookup).toBe(true);
    expect(result.command).toBe(`${shim()}\nlh topic list --json`);
  });

  it('should inject workspace scope for lh commands from workspace runs', async () => {
    const result = await preprocessLhCommand('lh agent view agt_123', 'user-1', 'workspace-1');

    expect(result.command).toBe(
      `${shim(" LOBEHUB_WORKSPACE_ID='workspace-1'")}\nlh agent view agt_123`,
    );
  });

  it('should emit the JWT once regardless of how many lh calls the script makes', async () => {
    const cmd = 'lh topic list --page 1 && lh topic list --page 2 && echo "done"';
    const result = await preprocessLhCommand(cmd, 'user-1');

    expect(result.command).toBe(`${shim()}\n${cmd}`);
    expect(result.command.match(/mock-jwt-token/g)).toHaveLength(1);
  });

  // Regression: the shim briefly used `export`, which put a full user auth
  // token in the environment of every command the model wrote — one
  // `echo $LOBEHUB_JWT` or `curl` away from exfiltration, and handed out even
  // to a script that merely mentions `lh` in quoted text, since detection is
  // deliberately permissive. Credentials must stay assignment-prefixed to the
  // `npx` process inside the function body.
  it('should keep credentials out of the parent shell environment', async () => {
    const result = await preprocessLhCommand('lh topic list && echo "$LOBEHUB_JWT"', 'user-1');

    expect(result.command).not.toContain('export ');

    const [shimLine] = result.command.split('\n');
    // The only occurrence of the token is inside the function body, prefixed to
    // `npx` — so it scopes to that one process and nothing else inherits it.
    expect(shimLine).toMatch(/^lh\(\) \{ .*LOBEHUB_JWT='mock-jwt-token'.* npx -y @lobehub\/cli/);
    expect(result.command.slice(shimLine.length)).not.toContain('mock-jwt-token');
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
    ['same-line case arm', 'case "$scope" in workspace) lh whoami ;; esac'],
    ['multiple case arms', 'case $x in a) lh agent list ;; b) lh topic list ;; esac'],
    ['inline env assignment', 'LOBEHUB_WORKSPACE_ID=ws lh agent list'],
    ['quoted inline assignment', 'FOO="a b" lh agent list'],
    // `!` and `time` are reserved words, so the shell still resolves `lh`
    // through the injected function — missing them left the command running as
    // a bare `lh` (not found in the sandbox, unscoped on a device).
    ['negated', '! lh whoami'],
    ['negated if condition', 'if ! lh whoami; then echo no; fi'],
    ['negated while condition', 'while ! lh agent list; do sleep 1; done'],
    ['negated after &&', 'cd /tmp && ! lh agent view agt_1'],
    ['timed', 'time lh agent list'],
    ['negated and timed', '! time lh agent list'],
    ['negated with inline assignment', '! FOO=1 lh agent list'],
  ])('detects %s', (_label, command) => {
    expect(isLhCommand(command)).toBe(true);
  });

  it.each([
    ['plain command', 'echo hello'],
    ['substring of a word', 'echoalhough'],
    ['npm script name', 'npm run lhtest'],
    ['a local script of the same name', './lh agent list'],
    ['a path segment', 'ls /opt/lh'],
    // `time` is matched as a whole word only.
    ['a word merely ending in time', 'notime lh'],
  ])('does not detect %s', (_label, command) => {
    expect(isLhCommand(command)).toBe(false);
  });
});

describe('buildDeviceLhEnv', () => {
  it('scopes the run to its workspace', () => {
    expect(buildDeviceLhEnv('ws-1')).toEqual({ LOBEHUB_WORKSPACE_ID: 'ws-1' });
  });

  it('never ships the caller JWT onto the device', () => {
    expect(buildDeviceLhEnv('ws-1')).not.toHaveProperty('LOBEHUB_JWT');
  });

  it('returns undefined for personal runs', () => {
    expect(buildDeviceLhEnv(undefined)).toBeUndefined();
  });

  // Regression: this used to be gated on `isLhCommand(command)`, so an `lh`
  // the command reached indirectly got no scope and silently fell back to the
  // device credentials' personal tenancy. The device merges env into the
  // spawned process, so setting it unconditionally is what covers these.
  it('scopes commands that reach lh indirectly, which no detector could match', () => {
    for (const command of ["bash -lc 'lh whoami'", 'make deploy', './sync.sh', 'npm run sync']) {
      expect(isLhCommand(command)).toBe(false);
      expect(buildDeviceLhEnv('ws-1')).toEqual({ LOBEHUB_WORKSPACE_ID: 'ws-1' });
    }
  });
});
