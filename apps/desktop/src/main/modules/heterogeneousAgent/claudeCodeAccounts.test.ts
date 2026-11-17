import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import type * as FsPromises from 'node:fs/promises';
import { lstat, mkdir, mkdtemp, readlink, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ClaudeCodeAccountProfiles,
  type ClaudeCodeLoginSpawnParams,
  resolveDefaultClaudeConfigDir,
  RETIRED_PROFILE_GRACE_MS,
  UNSHARED_PROJECTS_DIR,
} from './claudeCodeAccounts';

const fakeFs = vi.hoisted(() => ({
  home: '',
  /** Simulated Keychain latency of each login check, and how many overlap. */
  loginCheckDelayMs: 0,
  inFlight: 0,
  maxInFlight: 0,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return { ...actual, rename: vi.fn(actual.rename), symlink: vi.fn(actual.symlink) };
});

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, callback: () => void) =>
    callback(),
  ),
}));

// The sampler reads `<profile>/.claude.json` for identity and the profile's
// credentials for "signed in"; mirror both over the temp dirs used here.
vi.mock('@lobechat/heterogeneous-agents/quota-sampler', () => {
  const dirOf = (options: { claudeConfigDirPath?: string | null }) =>
    options.claudeConfigDirPath ?? path.join(fakeFs.home, '.claude');
  const identityFile = (options: { claudeConfigDirPath?: string | null }) =>
    options.claudeConfigDirPath
      ? path.join(options.claudeConfigDirPath, '.claude.json')
      : path.join(fakeFs.home, '.claude.json');
  return {
    claudeCodeKeychainService: (dir?: string | null) => `svc-${dir ?? 'default'}`,
    hasClaudeCodeLogin: async (options: { claudeConfigDirPath?: string | null }) => {
      fakeFs.inFlight += 1;
      fakeFs.maxInFlight = Math.max(fakeFs.maxInFlight, fakeFs.inFlight);
      await new Promise((resolve) => setTimeout(resolve, fakeFs.loginCheckDelayMs));
      fakeFs.inFlight -= 1;
      return existsSync(path.join(dirOf(options), '.credentials.json'));
    },
    readClaudeCodeIdentity: async (options: { claudeConfigDirPath?: string | null }) => {
      try {
        const { oauthAccount } = JSON.parse(readFileSync(identityFile(options), 'utf8'));
        return { email: oauthAccount.emailAddress, externalAccountId: oauthAccount.accountUuid };
      } catch {
        return null;
      }
    },
  };
});

const writeLogin = async (configDir: string | null, accountUuid: string) => {
  const dir = configDir ?? path.join(fakeFs.home, '.claude');
  const identityFile = configDir
    ? path.join(configDir, '.claude.json')
    : path.join(fakeFs.home, '.claude.json');
  await mkdir(dir, { recursive: true });
  await writeFile(
    identityFile,
    JSON.stringify({ oauthAccount: { accountUuid, emailAddress: `${accountUuid}@x.com` } }),
  );
  await writeFile(path.join(dir, '.credentials.json'), '{}');
};

class FakeChild extends EventEmitter {
  kill = vi.fn((signal: string) => {
    this.emit('exit', null, signal);
    return true;
  });
}

describe('ClaudeCodeAccountProfiles', () => {
  let root: string;
  let spawned: ClaudeCodeLoginSpawnParams[];
  let child: FakeChild;
  let profiles: ClaudeCodeAccountProfiles;

  beforeEach(async () => {
    fakeFs.home = await mkdtemp(path.join(tmpdir(), 'cc-accounts-home-'));
    Object.assign(fakeFs, { inFlight: 0, loginCheckDelayMs: 0, maxInFlight: 0 });
    root = path.join(fakeFs.home, 'profiles');
    spawned = [];
    profiles = new ClaudeCodeAccountProfiles({
      defaultConfigDir: path.join(fakeFs.home, '.claude'),
      root,
      spawnLogin: async (params) => {
        spawned.push(params);
        child = new FakeChild();
        return child as never;
      },
    });
  });

  afterEach(async () => {
    await rm(fakeFs.home, { force: true, recursive: true });
  });

  /** Start a login and let the fake CLI sign `accountUuid` in to the new profile. */
  const loginAs = async (accountUuid: string, email?: string) => {
    const before = spawned.length;
    const pending = profiles.login({ email });
    await vi.waitFor(() => expect(spawned.length).toBe(before + 1));
    const { configDir } = spawned.at(-1)!;
    await writeLogin(configDir, accountUuid);
    child.emit('exit', 0, null);
    return pending;
  };

  it('lists the default login and each signed-in profile once', async () => {
    await writeLogin(null, 'acc-default');
    await writeLogin(path.join(root, 'a'), 'acc-a');
    await writeLogin(path.join(root, 'b'), 'acc-a');
    await mkdir(path.join(root, 'signed-out'), { recursive: true });

    const accounts = await profiles.list();

    expect(accounts.map((a) => [a.configDir, a.identity.externalAccountId])).toEqual([
      [null, 'acc-default'],
      [path.join(root, 'a'), 'acc-a'],
    ]);
  });

  it('checks every login at once instead of one Keychain lookup after another', async () => {
    await writeLogin(null, 'acc-default');
    for (const id of ['a', 'b', 'c']) await writeLogin(path.join(root, id), `acc-${id}`);
    fakeFs.loginCheckDelayMs = 20;

    const accounts = await profiles.list();

    expect(fakeFs.maxInFlight).toBe(4);
    // Concurrency does not change the default-first order.
    expect(accounts.map((a) => a.identity.externalAccountId)).toEqual([
      'acc-default',
      'acc-a',
      'acc-b',
      'acc-c',
    ]);
  });

  it('resolves an account to the default login, its profile, or missing', async () => {
    await writeLogin(null, 'acc-default');
    await writeLogin(path.join(root, 'p1'), 'acc-p1');

    expect(await profiles.resolve('acc-default')).toEqual({ kind: 'default' });
    expect(await profiles.resolve('acc-p1')).toEqual({
      configDir: path.join(root, 'p1'),
      kind: 'profile',
    });
    expect(await profiles.resolve('acc-elsewhere')).toEqual({ kind: 'missing' });
  });

  it('shares transcripts with the default dir so a switched conversation can resume', async () => {
    await writeLogin(path.join(root, 'p1'), 'acc-p1');

    await profiles.resolve('acc-p1');

    const link = path.join(root, 'p1', 'projects');
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readlink(link)).toBe(path.join(fakeFs.home, '.claude', 'projects'));
  });

  /**
   * The kept-aside copy of a profile's transcripts. It must live outside the
   * profile, which is retired and removed when its account signs in again.
   */
  const keptAside = async (profile: string) => {
    const { readdir } = await vi.importActual<typeof FsPromises>('node:fs/promises');
    expect((await readdir(path.join(root, profile))).some((n) => n.includes('unshared'))).toBe(
      false,
    );
    const keptDir = path.join(fakeFs.home, '.claude', UNSHARED_PROJECTS_DIR);
    const name = (await readdir(keptDir)).find((n) => n.startsWith(`${profile}-`));
    expect(name).toBeDefined();
    return path.join(keptDir, name!);
  };

  // Regression: a profile signed in before transcripts were shared kept its own
  // `projects/`, the link was skipped, and a run switched onto that account
  // could not --resume a conversation started on another one (or vice versa).
  it('folds a profile’s own transcripts into the shared tree and links it', async () => {
    await writeLogin(path.join(root, 'p1'), 'acc-p1');
    const shared = path.join(fakeFs.home, '.claude', 'projects', '-repo');
    const own = path.join(root, 'p1', 'projects', '-repo');
    await mkdir(shared, { recursive: true });
    await mkdir(own, { recursive: true });
    await writeFile(path.join(shared, 'started-on-default.jsonl'), 'default');
    await writeFile(path.join(own, 'started-on-p1.jsonl'), 'p1');

    await profiles.resolve('acc-p1');

    const link = path.join(root, 'p1', 'projects');
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    // Each side now sees both conversations, so either account can resume either.
    expect(readFileSync(path.join(link, '-repo', 'started-on-default.jsonl'), 'utf8')).toBe(
      'default',
    );
    expect(readFileSync(path.join(shared, 'started-on-p1.jsonl'), 'utf8')).toBe('p1');
  });

  it('keeps a profile transcript aside instead of deleting it when the shared tree has the same name', async () => {
    await writeLogin(path.join(root, 'p1'), 'acc-p1');
    const shared = path.join(fakeFs.home, '.claude', 'projects', '-repo');
    const own = path.join(root, 'p1', 'projects', '-repo');
    await mkdir(shared, { recursive: true });
    await mkdir(own, { recursive: true });
    await writeFile(path.join(shared, 'same.jsonl'), 'shared');
    await writeFile(path.join(own, 'same.jsonl'), 'profile');

    await profiles.resolve('acc-p1');

    expect((await lstat(path.join(root, 'p1', 'projects'))).isSymbolicLink()).toBe(true);
    expect(readFileSync(path.join(shared, 'same.jsonl'), 'utf8')).toBe('shared');
    const aside = await keptAside('p1');
    expect(readFileSync(path.join(aside, '-repo', 'same.jsonl'), 'utf8')).toBe('profile');
  });

  it('never deletes a transcript written into the profile while it is being folded in', async () => {
    await writeLogin(path.join(root, 'p1'), 'acc-p1');
    const own = path.join(root, 'p1', 'projects', '-repo');
    await mkdir(own, { recursive: true });
    await writeFile(path.join(own, 'old.jsonl'), 'old');
    // A run on this account writes a new session file right after the listing.
    const fsp = await vi.importActual<typeof FsPromises>('node:fs/promises');
    const rename = vi.spyOn(await import('node:fs/promises'), 'rename');
    rename.mockImplementationOnce(async (from, to) => {
      await fsp.rename(from, to);
      await fsp.writeFile(path.join(root, 'p1', 'projects', 'late.jsonl'), 'late');
    });

    await profiles.resolve('acc-p1');

    const shared = path.join(fakeFs.home, '.claude', 'projects');
    // What was listed moved; the late file stays in the profile, which keeps its
    // own `projects` for now instead of losing it to the link.
    expect(readFileSync(path.join(shared, '-repo', 'old.jsonl'), 'utf8')).toBe('old');
    expect((await lstat(path.join(root, 'p1', 'projects'))).isSymbolicLink()).toBe(false);
    expect(readFileSync(path.join(root, 'p1', 'projects', 'late.jsonl'), 'utf8')).toBe('late');

    // The next resolve finishes the job.
    await profiles.resolve('acc-p1');

    expect((await lstat(path.join(root, 'p1', 'projects'))).isSymbolicLink()).toBe(true);
    expect(readFileSync(path.join(shared, 'late.jsonl'), 'utf8')).toBe('late');
  });

  // Regression: with the default config dir on another volume every rename
  // failed with EXDEV, the profile kept its own `projects`, and resume across
  // accounts stayed broken.
  it('folds transcripts in across filesystems, where rename fails with EXDEV', async () => {
    await writeLogin(path.join(root, 'p1'), 'acc-p1');
    const own = path.join(root, 'p1', 'projects', '-repo');
    await mkdir(own, { recursive: true });
    await writeFile(path.join(own, 'started-on-p1.jsonl'), 'p1');
    const fsp = await vi.importActual<typeof FsPromises>('node:fs/promises');
    const sharedRoot = path.join(fakeFs.home, '.claude');
    // Renames into the default config dir cross a volume; within the profile they do not.
    vi.spyOn(await import('node:fs/promises'), 'rename').mockImplementation(async (from, to) => {
      if (String(to).startsWith(sharedRoot))
        throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' });
      await fsp.rename(from, to);
    });

    await profiles.resolve('acc-p1');

    const link = path.join(root, 'p1', 'projects');
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(
      readFileSync(
        path.join(fakeFs.home, '.claude', 'projects', '-repo', 'started-on-p1.jsonl'),
        'utf8',
      ),
    ).toBe('p1');
  });

  // Regression: across volumes the original was unlinked after a metadata
  // check, so an append landing after the check went to a deleted file.
  it('never unlinks a cross-volume transcript under its live name', async () => {
    await writeLogin(path.join(root, 'p1'), 'acc-p1');
    const own = path.join(root, 'p1', 'projects', '-repo');
    await mkdir(own, { recursive: true });
    await writeFile(path.join(own, 'live.jsonl'), 'first');
    const fsp = await vi.importActual<typeof FsPromises>('node:fs/promises');
    const shared = path.join(fakeFs.home, '.claude', 'projects');
    // Only moves into the shared tree cross a volume; staging stays on the profile's.
    vi.spyOn(await import('node:fs/promises'), 'rename').mockImplementation(async (from, to) => {
      if (String(to).startsWith(shared))
        throw Object.assign(new Error('cross-device'), { code: 'EXDEV' });
      await fsp.rename(from, to);
      // The running session appends by path right after it was staged.
      if (String(from).endsWith('live.jsonl')) await fsp.writeFile(String(from), 'second');
    });

    await profiles.resolve('acc-p1');

    expect(readFileSync(path.join(shared, '-repo', 'live.jsonl'), 'utf8')).toBe('first');
    // The append survives under the live name; the profile keeps its projects.
    expect(readFileSync(path.join(own, 'live.jsonl'), 'utf8')).toBe('second');
    expect((await lstat(path.join(root, 'p1', 'projects'))).isSymbolicLink()).toBe(false);
  });

  it('shares with an inherited CLAUDE_CONFIG_DIR, the dir the default login runs on', async () => {
    const inheritedDir = path.join(fakeFs.home, 'custom-claude');
    profiles = new ClaudeCodeAccountProfiles({
      defaultConfigDir: resolveDefaultClaudeConfigDir(
        { CLAUDE_CONFIG_DIR: inheritedDir },
        fakeFs.home,
      ),
      root,
      spawnLogin: async () => new FakeChild() as never,
    });
    await writeLogin(path.join(root, 'p1'), 'acc-p1');

    await profiles.resolve('acc-p1');

    expect(await readlink(path.join(root, 'p1', 'projects'))).toBe(
      path.join(inheritedDir, 'projects'),
    );
  });

  it('falls back to ~/.claude when no CLAUDE_CONFIG_DIR is inherited', () => {
    expect(resolveDefaultClaudeConfigDir({}, '/home/me')).toBe(path.join('/home/me', '.claude'));
    expect(resolveDefaultClaudeConfigDir({ CLAUDE_CONFIG_DIR: '  ' }, '/home/me')).toBe(
      path.join('/home/me', '.claude'),
    );
  });

  it('still resolves a profile when its shared entries cannot be linked', async () => {
    await writeLogin(path.join(root, 'p1'), 'acc-p1');
    // `~/.claude` is not a directory, so even creating `projects` fails.
    await writeFile(path.join(fakeFs.home, '.claude'), 'not a dir');

    expect(await profiles.resolve('acc-p1')).toEqual({
      configDir: path.join(root, 'p1'),
      kind: 'profile',
    });
  });

  it('links shared directories as junctions on Windows, which need no elevation', async () => {
    await writeLogin(path.join(root, 'p1'), 'acc-p1');
    await mkdir(path.join(fakeFs.home, '.claude', 'skills'), { recursive: true });
    await writeFile(path.join(fakeFs.home, '.claude', 'settings.json'), '{}');
    const platform = process.platform;
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
    try {
      await profiles.resolve('acc-p1');
    } finally {
      Object.defineProperty(process, 'platform', { configurable: true, value: platform });
    }

    const typeOf = (name: string) =>
      vi
        .mocked(symlink)
        .mock.calls.find(([, target]) => target === path.join(root, 'p1', name))?.[2];
    expect(typeOf('projects')).toBe('junction');
    expect(typeOf('skills')).toBe('junction');
    expect(typeOf('settings.json')).toBeUndefined();
  });

  it('signs a new account in to its own profile through `claude auth login`', async () => {
    const account = await loginAs('acc-new', 'new@x.com');

    expect(spawned).toHaveLength(1);
    expect(spawned[0].args).toEqual(['auth', 'login', '--claudeai', '--email', 'new@x.com']);
    expect(path.dirname(spawned[0].configDir)).toBe(root);
    expect(account).toEqual({
      configDir: spawned[0].configDir,
      identity: expect.objectContaining({ externalAccountId: 'acc-new' }),
    });
    expect(await profiles.resolve('acc-new')).toEqual({
      configDir: spawned[0].configDir,
      kind: 'profile',
    });
  });

  it('replaces the older profile when an account signs in again', async () => {
    const first = await loginAs('acc-1');
    const second = await loginAs('acc-1');

    expect(second.configDir).not.toBe(first.configDir);
    expect((await profiles.list()).map((a) => a.configDir)).toEqual([second.configDir]);
    expect(await profiles.resolve('acc-1')).toEqual({
      configDir: second.configDir,
      kind: 'profile',
    });
  });

  it('keeps a replaced profile for in-flight runs, then forgets it after the grace period', async () => {
    const first = await loginAs('acc-1');
    await loginAs('acc-1');

    // A run that recorded the old path can still recover its transcript there.
    expect(existsSync(first.configDir!)).toBe(true);

    const expired = (Date.now() - RETIRED_PROFILE_GRACE_MS - 60_000) / 1000;
    await utimes(path.join(first.configDir!, '.lobehub-retired'), expired, expired);
    await profiles.list();

    expect(existsSync(first.configDir!)).toBe(false);
  });

  it('honors a cancel that lands after the CLI already exited', async () => {
    await writeLogin(path.join(root, 'old'), 'acc-1');
    const pending = profiles.login();
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    await writeLogin(spawned[0].configDir, 'acc-1');

    child.emit('exit', 0, null);
    profiles.cancelLogin();

    await expect(pending).rejects.toThrow('cancelled');
    // Nothing committed: the new login is gone and the existing profile untouched.
    expect(existsSync(spawned[0].configDir)).toBe(false);
    expect(await profiles.resolve('acc-1')).toEqual({
      configDir: path.join(root, 'old'),
      kind: 'profile',
    });
  });

  it('drops the new profile when the account is already the default login', async () => {
    await writeLogin(null, 'acc-default');

    const account = await loginAs('acc-default');

    expect(account.configDir).toBeNull();
    expect(existsSync(spawned[0].configDir)).toBe(false);
  });

  it('cancels a sign-in in progress and removes its half-made profile', async () => {
    const pending = profiles.login();
    await vi.waitFor(() => expect(spawned).toHaveLength(1));

    expect(profiles.cancelLogin()).toBe(true);

    await expect(pending).rejects.toThrow('cancelled');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(existsSync(spawned[0].configDir)).toBe(false);
  });

  it('rejects a second sign-in while one is running', async () => {
    const pending = profiles.login();

    await expect(profiles.login()).rejects.toThrow('already in progress');

    profiles.cancelLogin();
    await expect(pending).rejects.toThrow();
  });

  it('fails a sign-in that exits without a login', async () => {
    const pending = profiles.login();
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    child.emit('exit', 0, null);

    await expect(pending).rejects.toThrow('without a login');
    expect(existsSync(spawned[0].configDir)).toBe(false);
  });
});
