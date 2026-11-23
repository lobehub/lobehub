import * as childProcess from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type * as os from 'node:os';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The resolver is real here: these cases are about what a second scan sees in
// a process that is still running, which a mocked resolver cannot show. Only
// process launches are faked, and the home folder is an empty temp directory.
const fake = vi.hoisted(() => ({ home: '' }));

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof os>('node:os');
  return { ...actual, homedir: vi.fn(() => fake.home), platform: vi.fn(() => 'linux') };
});

vi.mock('node:child_process', () => ({ exec: vi.fn(), execFile: vi.fn() }));

const execFileMock = vi.mocked(childProcess.execFile);

const DAEMON_PATH = '/usr/local/bin:/usr/bin:/bin';
const LOGIN_SHELL = '/bin/bash';

/** The fake device: what the login shell prints and where codex is installed. */
const host: { codex?: string; loginShellPath: string } = { loginShellPath: DAEMON_PATH };

const loginShellReads = () =>
  execFileMock.mock.calls.filter(
    ([file, args]) => file === LOGIN_SHELL && Array.isArray(args) && args[0] === '-ilc',
  ).length;

const answer = (file: string, args: string[], env?: NodeJS.ProcessEnv): string | undefined => {
  if (file === LOGIN_SHELL && args[0] === '-ilc') return host.loginShellPath;
  if (!host.codex) return;

  if (file === 'which' && args[0] === 'codex') {
    const searched = (env?.PATH ?? process.env.PATH ?? '').split(':');
    return searched.includes(path.dirname(host.codex)) ? `${host.codex}\n` : undefined;
  }
  if (file === host.codex && args[0] === '--version') return 'codex-cli 0.171.0';
};

describe('scanHeterogeneousAgentsOnHost in a long-running host', () => {
  const original = { PATH: process.env.PATH, SHELL: process.env.SHELL };

  beforeEach(() => {
    vi.resetModules();
    fake.home = mkdtempSync(path.join(tmpdir(), 'scan-host-'));
    host.codex = undefined;
    host.loginShellPath = DAEMON_PATH;
    process.env.PATH = DAEMON_PATH;
    process.env.SHELL = LOGIN_SHELL;

    execFileMock.mockReset();
    execFileMock.mockImplementation(((file: string, args: string[], opts: any, cb: any) => {
      const callback = typeof opts === 'function' ? opts : cb;
      const stdout = answer(file, args, typeof opts === 'function' ? undefined : opts?.env);
      if (stdout === undefined) callback(new Error(`not found: ${file} ${args.join(' ')}`));
      else callback(null, { stderr: '', stdout });
      return {} as any;
    }) as any);
  });

  afterEach(() => {
    rmSync(fake.home, { force: true, recursive: true });
    process.env.PATH = original.PATH;
    if (original.SHELL === undefined) delete process.env.SHELL;
    else process.env.SHELL = original.SHELL;
  });

  it('finds a CLI installed after the first scan without restarting the host', async () => {
    const { scanHeterogeneousAgentsOnHost } = await import('./scanHost');

    const before = await scanHeterogeneousAgentsOnHost();
    expect(before.codex).toEqual({ available: false, version: undefined });

    // The user installs codex into a folder only their shell profile knows
    // about while `lh connect` keeps running, then presses "Rescan device".
    host.codex = path.join(fake.home, 'tools', 'bin', 'codex');
    host.loginShellPath = `${path.dirname(host.codex)}:${DAEMON_PATH}`;

    const after = await scanHeterogeneousAgentsOnHost();
    expect(after.codex).toEqual({ available: true, version: '0.171.0' });
  });

  it('reads the login shell once per scan, not once per agent', async () => {
    const { scanHeterogeneousAgentsOnHost } = await import('./scanHost');

    await scanHeterogeneousAgentsOnHost();
    expect(loginShellReads()).toBe(1);

    await scanHeterogeneousAgentsOnHost();
    expect(loginShellReads()).toBe(2);
  });

  it('finds codex in ~/.local/bin on Linux with no login shell to ask', async () => {
    // A user-level `npm i -g --prefix ~/.local` on a device whose service PATH
    // has no home folders and whose environment names no shell.
    delete process.env.SHELL;
    host.codex = path.join(fake.home, '.local', 'bin', 'codex');
    mkdirSync(path.dirname(host.codex), { recursive: true });
    writeFileSync(host.codex, '');
    chmodSync(host.codex, 0o755);

    const { scanHeterogeneousAgentsOnHost } = await import('./scanHost');
    const agents = await scanHeterogeneousAgentsOnHost();

    expect(agents.codex).toEqual({ available: true, version: '0.171.0' });
    expect(loginShellReads()).toBe(0);
  });
});
