import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  buildDeviceLhEnv,
  isDirectLhInvocation,
  isLhCommand,
  preprocessLhCommand,
} from '../preprocessLhCommand';

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
/**
 * The shim: an `lh` executable written to a fresh `PATH` directory, with
 * credentials scoped to the `npx` process it execs rather than exported.
 */
const wrap = (command: string, extraEnv = '') =>
  [
    `__lobehub_lh_bin=$(mktemp -d) && trap '[ -s "$__lobehub_lh_bin"/.jobs ] || rm -rf "$__lobehub_lh_bin"' EXIT && trap 'exit 129' HUP && trap 'exit 130' INT && trap 'exit 143' TERM && cat > "$__lobehub_lh_bin"/lh <<'__LOBEHUB_LH_SHIM__' && chmod 700 "$__lobehub_lh_bin"/lh && export PATH="$__lobehub_lh_bin":"$PATH" || { echo 'lh: could not set up LobeHub CLI credentials' >&2; exit 1; }`,
    '#!/bin/sh',
    `${CREDS}${extraEnv} exec npx -y @lobehub/cli "$@"`,
    '__LOBEHUB_LH_SHIM__',
    '(',
    `trap 'jobs -l > "$__lobehub_lh_bin"/.jobs; sed -n "s/^[[][0-9]*[]][ +-]*//; s/^ *\\([0-9][0-9]*\\).*/\\1/p" "$__lobehub_lh_bin"/.jobs > "$__lobehub_lh_bin"/.pids; mv "$__lobehub_lh_bin"/.pids "$__lobehub_lh_bin"/.jobs; if [ -s "$__lobehub_lh_bin"/.jobs ]; then (n=0; while read -r p; do while [ "$n" -lt 300 ] && kill -0 "$p" 2>/dev/null; do case "$(cat /proc/"$p"/stat 2>/dev/null)" in *") Z "*) break ;; esac; sleep 1; n=$((n + 1)); done; done < "$__lobehub_lh_bin"/.jobs; rm -rf "$__lobehub_lh_bin") >/dev/null 2>&1 </dev/null & fi' EXIT`,
    'lh() { "$__lobehub_lh_bin"/lh "$@"; }',
    command,
    ')',
  ].join('\n');

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
    expect(result.command).toBe(wrap('lh topic list --json'));
  });

  it('should inject workspace scope for lh commands from workspace runs', async () => {
    const result = await preprocessLhCommand('lh agent view agt_123', 'user-1', 'workspace-1');

    expect(result.command).toBe(
      wrap('lh agent view agt_123', " LOBEHUB_WORKSPACE_ID='workspace-1'"),
    );
  });

  it('should hand the run its own operation id, so a sandbox dispatch can be attributed', async () => {
    const result = await preprocessLhCommand(
      'lh agent run -a agt_123 -p hi',
      'user-1',
      'workspace-1',
      false,
      'op-1',
    );

    expect(result.command).toBe(
      wrap(
        'lh agent run -a agt_123 -p hi',
        " LOBEHUB_WORKSPACE_ID='workspace-1' LOBEHUB_OPERATION_ID='op-1'",
      ),
    );
  });

  it('should omit the operation id when the caller has no run context', async () => {
    const result = await preprocessLhCommand('lh topic list', 'user-1');

    expect(result.command).not.toContain('LOBEHUB_OPERATION_ID');
  });

  it('should emit the JWT once regardless of how many lh calls the script makes', async () => {
    const cmd = 'lh topic list --page 1 && lh topic list --page 2 && echo "done"';
    const result = await preprocessLhCommand(cmd, 'user-1');

    expect(result.command).toBe(wrap(cmd));
    expect(result.command.match(/mock-jwt-token/g)).toHaveLength(1);
  });

  // Regression: the shim briefly used `export`, which put a full user auth
  // token in the environment of every command the model wrote — one
  // `echo $LOBEHUB_JWT` or `curl` away from exfiltration, and handed out even
  // to a script that merely mentions `lh` in quoted text, since detection is
  // deliberately permissive. Credentials must stay assignment-prefixed to the
  // `npx` process inside the `lh` wrapper.
  it('should keep credentials out of the parent shell environment', async () => {
    const result = await preprocessLhCommand('lh topic list && echo "$LOBEHUB_JWT"', 'user-1');

    // Only `PATH` is exported, never a credential.
    expect(result.command.match(/export /g)).toHaveLength(1);
    expect(result.command).toContain('export PATH=');

    const lines = result.command.split('\n');
    // The only occurrence of the token is inside the wrapper body, prefixed to
    // `npx` — so it scopes to that one process and nothing else inherits it.
    const tokenLines = lines.filter((line) => line.includes('mock-jwt-token'));
    expect(tokenLines).toHaveLength(1);
    expect(tokenLines[0]).toMatch(/^LOBEHUB_JWT='mock-jwt-token'.* exec npx -y @lobehub\/cli/);
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

  // Belt-and-braces guard: `serverRuntimes/cloudSandbox.ts` already
  // short-circuits before ever calling this function for a share-visitor `lh`
  // command, but this function must independently refuse too — the caller
  // remembering to keep re-checking it must not be the only thing standing
  // between a share visitor and the creator's own JWT.
  it('should refuse and never sign a JWT when shareVisitorBlocked is set', async () => {
    mockSignUserJWT.mockClear();

    const result = await preprocessLhCommand('lh topic list', 'user-1', undefined, true);

    expect(result.isLhCommand).toBe(true);
    expect(result.error).toBe('The LobeHub CLI is unavailable in shared conversations.');
    expect(result.command).toBe('lh topic list');
    expect(mockSignUserJWT).not.toHaveBeenCalled();
  });

  // Regression: the permissive shim detector also drove the visitor refusal,
  // so a harmless command that merely mentions `lh` was rejected outright.
  it('should run a visitor command that only mentions lh unchanged, without signing', async () => {
    mockSignUserJWT.mockClear();

    const command = "echo 'the lh CLI is unavailable here'";
    const result = await preprocessLhCommand(command, 'user-1', undefined, true);

    expect(result.error).toBeUndefined();
    expect(result.command).toBe(command);
    expect(mockSignUserJWT).not.toHaveBeenCalled();
  });

  it('should leave a non-lh command untouched even when shareVisitorBlocked is set', async () => {
    const result = await preprocessLhCommand('echo hello', 'user-1', undefined, true);

    expect(result.isLhCommand).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.command).toBe('echo hello');
  });
});

/**
 * Runs the prepared command in a real POSIX shell, the way the sandbox does.
 * The fake bin dir mirrors the sandbox: a global `lh` with no credentials
 * (what the model hit before) and an `npx` that reports the credentials the
 * CLI process actually received.
 */
describe('preprocessLhCommand in a real shell', () => {
  let fakeBin: string;

  beforeAll(() => {
    fakeBin = mkdtempSync(path.join(tmpdir(), 'lh-shim-test-'));
    const writeBin = (name: string, body: string) => {
      const file = path.join(fakeBin, name);
      writeFileSync(file, `#!/bin/sh\n${body}\n`);
      chmodSync(file, 0o755);
    };
    writeBin('lh', `echo "No authentication found. Run 'lh login' first."`);
    writeBin('npx', 'echo "cli jwt=${LOBEHUB_JWT:-none}"');
  });

  afterAll(() => {
    rmSync(fakeBin, { force: true, recursive: true });
  });

  const run = async (command: string, shell = '/bin/sh') => {
    const { command: prepared } = await preprocessLhCommand(command, 'user-1');
    return execFileSync(shell, ['-c', prepared], {
      encoding: 'utf8',
      // An inherited token would mask a shim that failed to reach the CLI.
      env: { ...process.env, LOBEHUB_JWT: undefined, PATH: `${fakeBin}:${process.env.PATH}` },
    });
  };

  it('authenticates an lh the shell resolves itself', async () => {
    expect(await run('lh whoami')).toBe('cli jwt=mock-jwt-token\n');
  });

  // Regression: the shim was a shell function, which only exists inside the
  // shell that defined it. Any `lh` executed as a program — a child shell, an
  // `env` / `timeout` / `xargs` prefix, a script's subprocess — skipped it and
  // ran the unauthenticated global `lh` instead.
  it.each([
    ['a child shell', "sh -c 'lh whoami'"],
    ['an env prefix', 'env FOO=1 lh whoami'],
    ['xargs', 'echo whoami | xargs lh'],
    [
      'a node subprocess',
      `node -e "process.stdout.write(require('child_process').execFileSync('lh', ['whoami']))"`,
    ],
  ])('authenticates an lh reached through %s', async (_label, command) => {
    expect(await run(command)).toBe('cli jwt=mock-jwt-token\n');
  });

  // Regression: an inline `PATH=` assignment replaces the lookup path for that
  // one `lh`, skipping the exported wrapper directory.
  it('authenticates an lh whose inline PATH assignment puts another lh first', async () => {
    expect(await run(`PATH=${fakeBin}:"$PATH" lh whoami`)).toBe('cli jwt=mock-jwt-token\n');
  });

  // Regression: the sandbox session outlives the command, so a wrapper left on
  // disk kept a live user token readable by every later command in the topic.
  it('removes the credentialed wrapper once the command ends', async () => {
    const dir = await run('lh whoami >/dev/null; printf %s "$__lobehub_lh_bin"');

    expect(dir).not.toBe('');
    expect(existsSync(dir)).toBe(false);
  });

  it('removes it even when the command traps EXIT itself and exits non-zero', async () => {
    const error = await run(
      `lh whoami >/dev/null; trap 'echo bye' EXIT; printf '%s\\n' "$__lobehub_lh_bin"; exit 3`,
    ).catch((error_: { status: number; stdout: string }) => error_);

    expect(error).toMatchObject({ status: 3 });
    const [dir] = (error as { stdout: string }).stdout.split('\n');
    expect(dir).not.toBe('');
    expect(existsSync(dir)).toBe(false);
  });

  // Regression: removing the wrapper on exit raced a backgrounded `lh`, which
  // then ran the unauthenticated global `lh` (or failed to open the wrapper).
  it('keeps the wrapper for an lh started in the background after the script ends', async () => {
    const out = path.join(fakeBin, 'background.out');
    await run(`(sleep 1; lh whoami > '${out}') &`);

    expect(readFileSync(out, 'utf8')).toBe('cli jwt=mock-jwt-token\n');
  });

  // Regression: `jobs -p` lists one pid per job, so a background pipeline whose
  // first member exits early lost the wrapper under a later member's `lh`.
  // bash and dash format `jobs -l` differently; cover whichever are installed.
  it.each(['/bin/sh', '/bin/bash', '/bin/dash'].filter((shell) => existsSync(shell)))(
    'keeps the wrapper for every member of a background pipeline in %s',
    async (shell) => {
      const out = path.join(fakeBin, `pipeline-${path.basename(shell)}.out`);
      await run(`printf x | { sleep 1; lh whoami > '${out}'; } &`, shell);

      expect(readFileSync(out, 'utf8')).toBe('cli jwt=mock-jwt-token\n');
    },
  );

  // Regression: the job hand-off ran after the command, so an `exit` or a
  // `set -e` failure skipped it and the wrapper was removed under the job.
  it.each([
    ['an explicit exit', 'exit 0'],
    ['a set -e failure', 'set -e; false'],
  ])('keeps the wrapper for a background lh after %s', async (_label, ending) => {
    const out = path.join(fakeBin, `after-exit-${ending.length}.out`);
    await run(`(sleep 1; lh whoami > '${out}') & ${ending}`).catch(() => undefined);

    expect(readFileSync(out, 'utf8')).toBe('cli jwt=mock-jwt-token\n');
  });

  // Regression: joining every background job blocked the command on an
  // unrelated long-lived process such as a dev server.
  it('returns without waiting for a long-running background job, then removes the wrapper', async () => {
    const startedAt = Date.now();
    const dir = await run(
      `lh whoami >/dev/null; sleep 3 >/dev/null 2>&1 & printf %s "$__lobehub_lh_bin"`,
    );

    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(existsSync(`${dir}/lh`)).toBe(true);

    await vi.waitFor(() => expect(existsSync(dir)).toBe(false), { interval: 200, timeout: 6000 });
  });

  // Regression: a failed setup fell through to the command, whose `lh` then ran
  // the unauthenticated global binary.
  it('stops before the command when the wrapper cannot be written', async () => {
    const failBin = mkdtempSync(path.join(tmpdir(), 'lh-shim-fail-'));
    writeFileSync(path.join(failBin, 'mktemp'), '#!/bin/sh\nexit 1\n');
    chmodSync(path.join(failBin, 'mktemp'), 0o755);
    const { command: prepared } = await preprocessLhCommand('echo ran; lh whoami', 'user-1');

    let error: { status: number; stderr: string; stdout: string } | undefined;
    try {
      execFileSync('/bin/sh', ['-c', prepared], {
        encoding: 'utf8',
        env: {
          ...process.env,
          LOBEHUB_JWT: undefined,
          PATH: `${failBin}:${fakeBin}:${process.env.PATH}`,
        },
        stdio: 'pipe',
      });
    } catch (error_) {
      error = error_ as typeof error;
    } finally {
      rmSync(failBin, { force: true, recursive: true });
    }

    expect(error).toMatchObject({ status: 1 });
    expect(error!.stderr).toContain('could not set up LobeHub CLI credentials');
    expect(error!.stdout).not.toContain('ran');
  });

  it('keeps the token out of the script environment', async () => {
    expect(
      await run(
        'lh whoami >/dev/null; echo "shell jwt=${LOBEHUB_JWT:-none}"; env | grep -c LOBEHUB_JWT || true',
      ),
    ).toBe('shell jwt=none\n0\n');
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
    // Regression: `lh` reached through another program used to go undetected
    // (or get a shell-function shim the child process could not see), so it
    // ran the sandbox's own unauthenticated `lh` — "No authentication found"
    // mid-session, which agents reported as the injected JWT vanishing.
    ['timeout wrapper', 'echo start; timeout 120 lh doctor --json'],
    ['loop body behind timeout', 'for i in 1 2 3; do timeout 30 lh doctor --json; done'],
    ['child shell', "bash -c 'set -e; lh skill view skl_1 --json | jq -r .content'"],
    ['env prefix', 'env FOO=1 lh agent list'],
    ['nohup', 'nohup lh agent list &'],
    ['xargs', 'echo agt_1 | xargs lh agent view'],
    ['python subprocess', `python3 -c "import subprocess; subprocess.run(['lh', 'whoami'])"`],
    ['node child process', "node -e \"require('child_process').execFileSync('lh', ['whoami'])\""],
  ])('detects %s', (_label, command) => {
    expect(isLhCommand(command)).toBe(true);
  });

  it.each([
    ['plain command', 'echo hello'],
    ['substring of a word', 'echoalhough'],
    ['npm script name', 'npm run lhtest'],
    ['a local script of the same name', './lh agent list'],
    ['a path segment', 'ls /opt/lh'],
    ['a filename', 'cat lh.js'],
    ['a hyphenated script name', 'npm run lh-sync'],
    ['a home-relative path', '~/lh whoami'],
  ])('does not detect %s', (_label, command) => {
    expect(isLhCommand(command)).toBe(false);
  });
});

describe('isDirectLhInvocation', () => {
  it.each([
    ['bare', 'lh agent list'],
    ['after &&', 'cd /tmp && lh agent view agt_1'],
    ['second line of a script', 'echo hi\nlh whoami'],
    ['negated if condition', 'if ! lh whoami; then echo no; fi'],
  ])('detects %s', (_label, command) => {
    expect(isDirectLhInvocation(command)).toBe(true);
  });

  // These only mention `lh` (or reach it through another program), so a
  // visitor refusal keyed on them would block harmless commands.
  it.each([
    ['quoted prose', "echo 'the lh CLI is unavailable here'"],
    ['a comment', '# lh is not available\nls'],
    ['a timeout wrapper', 'timeout 60 lh whoami'],
  ])('does not detect %s', (_label, command) => {
    expect(isLhCommand(command)).toBe(true);
    expect(isDirectLhInvocation(command)).toBe(false);
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
    for (const command of ['make deploy', './sync.sh', 'npm run sync']) {
      expect(isLhCommand(command)).toBe(false);
      expect(buildDeviceLhEnv('ws-1')).toEqual({ LOBEHUB_WORKSPACE_ID: 'ws-1' });
    }
  });
});
