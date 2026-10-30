import { type ChildProcess, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import type {
  ClaudeCodeAccountResolution,
  ClaudeCodeLocalAccount,
  QuotaAccountIdentity,
} from '@lobechat/heterogeneous-agents/quota';
import {
  claudeCodeKeychainService,
  hasClaudeCodeLogin,
  readClaudeCodeIdentity,
} from '@lobechat/heterogeneous-agents/quota-sampler';

const DIRECTORY_MODE = 0o700;

/**
 * A profile replaced by a newer sign-in of the same account is retired, not
 * deleted: an in-flight run may have recorded its path, and recovery after a
 * restart replays the transcript from there. It is forgotten once the grace
 * period has passed.
 */
const RETIRED_MARKER = '.lobehub-retired';
export const RETIRED_PROFILE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** OAuth in the browser is human-paced; give up on an abandoned login eventually. */
export const CLAUDE_CODE_LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Entries of the default login's config dir a per-account profile links instead of
 * owning. Transcripts (`projects`) are shared so a conversation can switch
 * accounts and still `--resume` its native history; the rest is the user's own
 * CLI setup, which should not change with the account. Credentials and the
 * account identity (`.claude.json`) stay per profile — that is the point.
 */
const SHARED_ENTRIES = [
  'projects',
  'settings.json',
  'CLAUDE.md',
  'agents',
  'commands',
  'skills',
  'plugins',
  'output-styles',
] as const;

export type { ClaudeCodeAccountResolution, ClaudeCodeLocalAccount };

export interface ClaudeCodeLoginSpawnParams {
  args: string[];
  configDir: string;
}

interface LoginInProgress {
  cancelled?: boolean;
  configDir: string;
  process?: ChildProcess;
}

/**
 * The config dir of the default login — the one a spawn with no routing
 * override uses, and the profiles share entries with: a `CLAUDE_CONFIG_DIR`
 * the desktop process inherited, else `~/.claude`. Same resolution as the
 * login lookup (`readSignedInIdentity(null)`), so both sides of an account
 * switch see one transcript tree.
 */
export const resolveDefaultClaudeConfigDir = (
  inheritedEnv: Record<string, string | undefined>,
  home: string = homedir(),
): string => {
  const inherited = inheritedEnv.CLAUDE_CONFIG_DIR;
  return inherited?.trim() ? inherited : path.join(home, '.claude');
};

export interface ClaudeCodeAccountProfilesOptions {
  /** The default login's config dir, which profiles share entries with. */
  defaultConfigDir: string;
  /** Root holding one directory per account profile. */
  root: string;
  /** Start `claude <args>` with `CLAUDE_CONFIG_DIR=<configDir>`. */
  spawnLogin: (params: ClaudeCodeLoginSpawnParams) => Promise<ChildProcess>;
  timeoutMs?: number;
}

/**
 * The signed-in identity of one login. `null` configDir is whatever a spawn
 * with no routing override uses — the default login, or a `CLAUDE_CONFIG_DIR`
 * the desktop process itself inherited.
 */
const readSignedInIdentity = async (
  configDir: string | null,
): Promise<QuotaAccountIdentity | null> => {
  const options = { claudeConfigDirPath: configDir };
  const identity = await readClaudeCodeIdentity(options).catch(() => null);
  if (!identity?.externalAccountId) return null;
  return (await hasClaudeCodeLogin(options).catch(() => false)) ? identity : null;
};

/**
 * Drop a profile and the macOS Keychain item its login lives in — removing
 * only the directory would strand a live OAuth token in the Keychain. `rm`
 * unlinks the shared-entry symlinks without following them into the default dir.
 */
const forgetProfile = async (configDir: string) => {
  await rm(configDir, { force: true, recursive: true });
  if (process.platform !== 'darwin') return;
  await new Promise<void>((resolve) => {
    execFile(
      'security',
      ['delete-generic-password', '-s', claudeCodeKeychainService(configDir)],
      { timeout: 3000 },
      () => resolve(),
    );
  });
};

/**
 * Windows only creates file and directory symlinks with Developer Mode or
 * elevation; a junction links a directory without either. Elsewhere the type
 * is ignored.
 */
const linkTypeFor = async (source: string): Promise<'junction' | undefined> => {
  if (process.platform !== 'win32') return undefined;
  return (await stat(source)).isDirectory() ? 'junction' : undefined;
};

const retireProfile = async (configDir: string) => {
  await writeFile(path.join(configDir, RETIRED_MARKER), new Date().toISOString());
};

const exists = async (target: string) => {
  try {
    await lstat(target);
    return true;
  } catch {
    return false;
  }
};

/**
 * The Claude Code logins this machine can run on: the default login plus one
 * isolated `CLAUDE_CONFIG_DIR` profile per account the user signed in to from
 * LobeHub. Account routing maps the account the server picked to one of these;
 * an account with no local login here cannot run here.
 */
export class ClaudeCodeAccountProfiles {
  readonly #defaultConfigDir: string;
  readonly #root: string;
  readonly #spawnLogin: ClaudeCodeAccountProfilesOptions['spawnLogin'];
  readonly #timeoutMs: number;
  #login?: LoginInProgress;

  constructor(options: ClaudeCodeAccountProfilesOptions) {
    this.#defaultConfigDir = options.defaultConfigDir;
    this.#root = options.root;
    this.#spawnLogin = options.spawnLogin;
    this.#timeoutMs = options.timeoutMs ?? CLAUDE_CODE_LOGIN_TIMEOUT_MS;
  }

  /** Every signed-in local login, default first; one entry per account. */
  list = async (): Promise<ClaudeCodeLocalAccount[]> => {
    const accounts: ClaudeCodeLocalAccount[] = [];
    const seen = new Set<string>();
    const add = (configDir: string | null, identity: QuotaAccountIdentity | null) => {
      const id = identity?.externalAccountId;
      if (!identity || !id || seen.has(id)) return;
      seen.add(id);
      accounts.push({ configDir, identity });
    };

    // A sign-in still running has no account yet.
    const configDirs = [
      null,
      ...(await this.#profileDirs()).filter((dir) => dir !== this.#login?.configDir),
    ];
    // Each check may wait on a Keychain lookup with its own timeout: scan all
    // logins at once, then keep the default-first order when deduping.
    const identities = await Promise.all(configDirs.map((dir) => readSignedInIdentity(dir)));
    configDirs.forEach((dir, index) => add(dir, identities[index]));

    return accounts;
  };

  /** Map a provider account to the local login a spawn should use for it. */
  resolve = async (externalAccountId: string): Promise<ClaudeCodeAccountResolution> => {
    const match = (await this.list()).find(
      (account) => account.identity.externalAccountId === externalAccountId,
    );
    if (!match) return { kind: 'missing' };
    if (!match.configDir) return { kind: 'default' };

    // Sharing is best-effort: the profile runs without it (a missing
    // transcript is rebuilt into the profile on resume), so a link problem
    // must not fail the lookup and with it the run.
    await this.#linkSharedEntries(match.configDir).catch(() => {});
    return { configDir: match.configDir, kind: 'profile' };
  };

  /**
   * Sign an account in to a fresh profile through `claude auth login`, which
   * opens the browser and returns once the OAuth callback lands. A login that
   * turns out to be an account this machine already has replaces that
   * account's profile (or is dropped, for the default login), so each account
   * keeps exactly one local login.
   */
  login = async (options: { email?: string } = {}): Promise<ClaudeCodeLocalAccount> => {
    if (this.#login) throw new Error('A Claude Code sign-in is already in progress');

    const configDir = path.join(this.#root, randomUUID());
    const login: LoginInProgress = { configDir };
    this.#login = login;
    // Cancel can land at any await, including after the CLI already exited:
    // nothing may be committed once it has.
    const assertNotCancelled = () => {
      if (login.cancelled) throw new Error('Claude Code sign-in was cancelled');
    };

    try {
      await mkdir(configDir, { mode: DIRECTORY_MODE, recursive: true });
      await this.#linkSharedEntries(configDir);
      const args = ['auth', 'login', '--claudeai'];
      if (options.email) args.push('--email', options.email);
      assertNotCancelled();
      const child = await this.#spawnLogin({ args, configDir });
      login.process = child;
      if (login.cancelled) child.kill('SIGTERM');
      await this.#waitForExit(child);
      assertNotCancelled();

      const identity = await readSignedInIdentity(configDir);
      if (!identity) throw new Error('Claude Code sign-in finished without a login');

      const existing = (await this.list()).find(
        (account) => account.identity.externalAccountId === identity.externalAccountId,
      );
      assertNotCancelled();
      if (existing && !existing.configDir) {
        await forgetProfile(configDir);
        return existing;
      }
      if (existing?.configDir) await retireProfile(existing.configDir);

      return { configDir, identity };
    } catch (error) {
      await forgetProfile(configDir);
      throw error;
    } finally {
      this.#login = undefined;
    }
  };

  /** Abort the sign-in in progress, if any; its half-made profile is removed. */
  cancelLogin = (): boolean => {
    const login = this.#login;
    if (!login) return false;
    login.cancelled = true;
    login.process?.kill('SIGTERM');
    return true;
  };

  /** Live profile dirs; retired ones are skipped, and forgotten after the grace period. */
  #profileDirs = async (): Promise<string[]> => {
    let dirs: string[];
    try {
      const entries = await readdir(this.#root, { withFileTypes: true });
      dirs = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(this.#root, entry.name))
        .sort();
    } catch {
      return [];
    }

    const retiredAt = await Promise.all(
      dirs.map((dir) =>
        stat(path.join(dir, RETIRED_MARKER)).then(
          (marker) => marker.mtimeMs,
          () => undefined,
        ),
      ),
    );
    const now = Date.now();
    await Promise.all(
      dirs.map((dir, index) => {
        const at = retiredAt[index];
        return at !== undefined && now - at > RETIRED_PROFILE_GRACE_MS
          ? forgetProfile(dir).catch(() => {})
          : undefined;
      }),
    );
    return dirs.filter((_, index) => retiredAt[index] === undefined);
  };

  /**
   * Link the shared entries that exist in the default login's config dir
   * (always `projects`, so transcripts written from either side land in one
   * place). Idempotent, and never replaces an entry the profile already has.
   */
  #linkSharedEntries = async (configDir: string) => {
    const defaultDir = this.#defaultConfigDir;
    await mkdir(path.join(defaultDir, 'projects'), { recursive: true });

    for (const name of SHARED_ENTRIES) {
      const source = path.join(defaultDir, name);
      const target = path.join(configDir, name);
      if (!(await exists(source)) || (await exists(target))) continue;
      try {
        await symlink(source, target, await linkTypeFor(source));
      } catch {
        // A concurrent resolve made it first, or the filesystem refuses links:
        // the profile still runs without that entry, and a missing transcript
        // is rebuilt into the profile on resume.
      }
    }
  };

  #waitForExit = (child: ChildProcess) =>
    new Promise<void>((resolve, reject) => {
      let stderr = '';
      child.stderr?.on('data', (chunk) => {
        stderr = `${stderr}${chunk}`.slice(-2000);
      });
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Claude Code sign-in timed out'));
      }, this.#timeoutMs);

      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else if (signal) reject(new Error('Claude Code sign-in was cancelled'));
        else reject(new Error(stderr.trim() || `claude auth login exited with code ${code}`));
      });
    });
}
