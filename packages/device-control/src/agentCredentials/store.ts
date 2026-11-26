import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  DEVICE_AGENT_CREDENTIAL_PROVIDERS,
  type DeviceAgentCredentialProvider,
  type InstallAgentCredentialParams,
  type InstallAgentCredentialResult,
  type RemoveAgentCredentialParams,
  type RemoveAgentCredentialResult,
} from '@lobechat/types';

import {
  agentCredentialRunDir,
  stopAgentCredentialRuns,
  type StopAgentCredentialRunsOptions,
} from './runLease';

/** Owner-only access: the store holds bearer secrets. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

const CREDENTIAL_FILE = 'credential.json';
const STORE_VERSION = 1;

export interface AgentCredentialStoreOptions {
  /** Clock for expiry decisions; tests pin it. */
  now?: () => number;
  /**
   * Directory holding every installed credential, one subdirectory per
   * provider. Every client on a device must use the same one, because the
   * client that installs a credential may not be the one that runs the agent.
   */
  rootDir: string;
  /** Timing of stopping runs on a replaced login; tests shorten it. */
  runStop?: StopAgentCredentialRunsOptions;
}

/**
 * `~/.lobehub/agent-credentials`, shared by the desktop app and `lh connect`.
 * The desktop passes Electron's home path; the CLI uses the OS one.
 */
export const defaultAgentCredentialRootDir = (homeDir: string = os.homedir()) =>
  path.join(homeDir, '.lobehub', 'agent-credentials');

/**
 * Where one provider's credential and managed profile live. Only
 * `credential.json` and the Codex `home/auth.json` hold secrets; the profile
 * dirs keep transcripts and memory, so removal leaves them.
 */
const agentCredentialPaths = (rootDir: string, provider: DeviceAgentCredentialProvider) => {
  const dir = path.join(rootDir, provider);
  return {
    /** `CLAUDE_CONFIG_DIR` for runs on the installed Claude Code credential. */
    claudeConfigDir: path.join(dir, 'config'),
    /** `CODEX_HOME` holding the installed Codex `auth.json`. */
    codexHome: path.join(dir, 'home'),
    codexAuthFile: path.join(dir, 'home', 'auth.json'),
    dir,
    metadataFile: path.join(dir, CREDENTIAL_FILE),
    /** Leases of the runs using this credential (see `runLease.ts`). */
    runDir: agentCredentialRunDir(dir),
  };
};

/** Lease directory for runs on `provider`'s installed credential. */
export const agentCredentialRunDirFor = (
  rootDir: string,
  provider: DeviceAgentCredentialProvider,
) => agentCredentialPaths(rootDir, provider).runDir;

const isAgentCredentialProvider = (value: unknown): value is DeviceAgentCredentialProvider =>
  typeof value === 'string' &&
  (DEVICE_AGENT_CREDENTIAL_PROVIDERS as readonly string[]).includes(value);

const invalidParams = (detail: string) => new Error(`Invalid agent credential params: ${detail}`);

const parseProvider = (params: unknown): DeviceAgentCredentialProvider => {
  const provider = (params as { provider?: unknown } | null)?.provider;
  if (!isAgentCredentialProvider(provider)) {
    throw invalidParams(
      `provider must be one of ${DEVICE_AGENT_CREDENTIAL_PROVIDERS.map((p) => `"${p}"`).join(', ')}`,
    );
  }
  return provider;
};

/** A Codex `auth.json` must at least parse to an object. */
const parseCodexAuthJson = (authJson: string): Record<string, unknown> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(authJson);
  } catch {
    // Never echo the parser message: it can quote part of the secret.
    throw invalidParams('secret.authJson is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw invalidParams('secret.authJson must be a JSON object');
  }
  return parsed as Record<string, unknown>;
};

const decodeJwtPayload = (token: unknown): Record<string, unknown> | undefined => {
  if (typeof token !== 'string') return undefined;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString());
    return payload && typeof payload === 'object' ? payload : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Who a Codex `auth.json` logs in as: the ChatGPT account plus the user in
 * it (one Team account holds many users), or the API key. `undefined` when
 * it cannot be told, which callers must treat as a different login.
 */
const codexLoginIdentity = (authJson: string | undefined): string | undefined => {
  if (authJson === undefined) return undefined;
  let auth: { OPENAI_API_KEY?: unknown; tokens?: Record<string, unknown> };
  try {
    auth = JSON.parse(authJson);
  } catch {
    return undefined;
  }
  const tokens = auth?.tokens;
  if (tokens && typeof tokens === 'object') {
    const accountId = typeof tokens.account_id === 'string' ? tokens.account_id : undefined;
    const user = decodeJwtPayload(tokens.id_token)?.sub;
    if (!accountId || typeof user !== 'string' || !user) return undefined;
    return `chatgpt:${accountId}:${user}`;
  }
  if (typeof auth?.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY) {
    return `api-key:${createHash('sha256').update(auth.OPENAI_API_KEY).digest('hex')}`;
  }
  return undefined;
};

/** Reported by a Codex run stopped because its login was replaced. */
export const CODEX_CREDENTIAL_REPLACED_REASON =
  'The Codex account on this device was replaced, so this run was stopped before it could keep using the previous account. Send the message again to continue on the new account.';

/**
 * Validate untrusted RPC params. Error messages name the bad field only, never
 * its value, because they travel back over the gateway.
 */
export const parseInstallAgentCredentialParams = (
  params: unknown,
): InstallAgentCredentialParams => {
  const provider = parseProvider(params);
  const secret = (params as { secret?: unknown }).secret as Record<string, unknown> | undefined;
  if (!secret || typeof secret !== 'object') throw invalidParams('secret is required');

  if (provider === 'claude-code') {
    if (secret.type !== 'claude-oauth-token') {
      throw invalidParams('provider "claude-code" takes a secret of type "claude-oauth-token"');
    }
    if (typeof secret.token !== 'string' || !secret.token.trim()) {
      throw invalidParams('secret.token must be a non-empty string');
    }
    if (typeof secret.expiresAt !== 'string' || Number.isNaN(Date.parse(secret.expiresAt))) {
      throw invalidParams('secret.expiresAt must be an ISO date');
    }
    return {
      provider,
      secret: {
        expiresAt: new Date(secret.expiresAt).toISOString(),
        token: secret.token.trim(),
        type: 'claude-oauth-token',
      },
    };
  }

  if (secret.type !== 'codex-auth-json') {
    throw invalidParams('provider "codex" takes a secret of type "codex-auth-json"');
  }
  if (typeof secret.authJson !== 'string' || !secret.authJson.trim()) {
    throw invalidParams('secret.authJson must be a non-empty string');
  }
  parseCodexAuthJson(secret.authJson);
  return { provider, secret: { authJson: secret.authJson, type: 'codex-auth-json' } };
};

export const parseAgentCredentialProviderParams = (
  params: unknown,
): RemoveAgentCredentialParams => ({ provider: parseProvider(params) });

/** Create (or tighten) a directory so only the owner can enter it. */
const ensurePrivateDir = async (dir: string) => {
  await mkdir(dir, { mode: DIR_MODE, recursive: true });
  // `mkdir` honours the umask and leaves an existing directory alone.
  await chmod(dir, DIR_MODE);
};

/** Write through a private temp file and rename, so a reader never sees half a secret. */
const writePrivateFile = async (file: string, content: string) => {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, content, { encoding: 'utf8', flag: 'wx', mode: FILE_MODE });
    await chmod(temp, FILE_MODE);
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
};

const pathExists = (target: string) =>
  lstat(target).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    },
  );

const fileExists = (file: string) =>
  lstat(file).then(
    (stat) => stat.isFile(),
    () => false,
  );

interface StoredMetadata {
  expiresAt?: string;
  installedAt: string;
  provider: DeviceAgentCredentialProvider;
  /** Claude Code only: the OAuth token. Codex keeps its secret in `auth.json`. */
  token?: string;
  version: number;
}

export const installAgentCredential = async (
  params: unknown,
  options: AgentCredentialStoreOptions,
): Promise<InstallAgentCredentialResult> => {
  const { provider, secret } = parseInstallAgentCredentialParams(params);
  const paths = agentCredentialPaths(options.rootDir, provider);
  const installedAt = new Date(options.now?.() ?? Date.now()).toISOString();

  await ensurePrivateDir(options.rootDir);
  await ensurePrivateDir(paths.dir);
  let stoppedRuns = 0;

  if (secret.type === 'claude-oauth-token') {
    // Isolated config dir: a stale login in `~/.claude` (or an `apiKeyHelper`
    // in its settings) must not outrank the installed token.
    await ensurePrivateDir(paths.claudeConfigDir);
    const metadata: StoredMetadata = {
      expiresAt: secret.expiresAt,
      installedAt,
      provider,
      token: secret.token,
      version: STORE_VERSION,
    };
    await writePrivateFile(paths.metadataFile, JSON.stringify(metadata));
  } else {
    await ensurePrivateDir(paths.codexHome);
    // The auth.json this install replaces, restored if the install fails, so
    // a failed install never leaves the device running on the new login.
    const previousAuthJson = (await fileExists(paths.codexAuthFile))
      ? await readFile(paths.codexAuthFile, 'utf8')
      : undefined;
    const nextIdentity = codexLoginIdentity(secret.authJson);
    // Same login reinstalled: a run renewing it writes back the same account.
    // No previous login counts as replaced: a run may outlive a removal.
    const replacesLogin =
      nextIdentity === undefined || codexLoginIdentity(previousAuthJson) !== nextIdentity;
    try {
      await writePrivateFile(paths.codexAuthFile, secret.authJson);
      const metadata: StoredMetadata = { installedAt, provider, version: STORE_VERSION };
      await writePrivateFile(paths.metadataFile, JSON.stringify(metadata));
      if (replacesLogin) {
        // A run still on the previous login renews it in place and would
        // write it back over this one, so every later run bills the previous
        // account. Runs leased from here on read the new login; stop the
        // earlier ones (some may already be on it), then undo anything they
        // wrote back.
        stoppedRuns = await stopAgentCredentialRuns(
          paths.runDir,
          CODEX_CREDENTIAL_REPLACED_REASON,
          options.runStop,
        );
        const current = await readFile(paths.codexAuthFile, 'utf8').catch(() => undefined);
        // Keep a renewal of the new login (a run started after the first
        // write may have rotated its refresh token); restore anything else.
        const keepsNewLogin =
          current === secret.authJson ||
          (nextIdentity !== undefined && codexLoginIdentity(current) === nextIdentity);
        if (!keepsNewLogin) await writePrivateFile(paths.codexAuthFile, secret.authJson);
      }
    } catch (error) {
      await (
        previousAuthJson === undefined
          ? rm(paths.codexAuthFile, { force: true })
          : writePrivateFile(paths.codexAuthFile, previousAuthJson)
      ).catch(() => {});
      throw error;
    }
  }

  return { installed: true, provider, ...(stoppedRuns > 0 ? { stoppedRuns } : {}) };
};

/**
 * Delete the provider's secret files. The managed profile (transcripts,
 * memory, seeded config) stays, so a later reinstall can resume its sessions;
 * without the secret it is never used for a run. Idempotent.
 */
export const removeAgentCredential = async (
  params: unknown,
  options: AgentCredentialStoreOptions,
): Promise<RemoveAgentCredentialResult> => {
  const { provider } = parseAgentCredentialProviderParams(params);
  const paths = agentCredentialPaths(options.rootDir, provider);
  const secretFiles =
    provider === 'codex' ? [paths.metadataFile, paths.codexAuthFile] : [paths.metadataFile];
  let removed = false;
  for (const file of secretFiles) {
    if (!(await pathExists(file))) continue;
    await rm(file, { force: true });
    removed = true;
  }
  return { removed };
};

export type InstalledAgentCredential =
  | { status: 'missing' }
  /** Something is on disk but cannot be used; a reinstall fixes it. */
  | { status: 'invalid' }
  | {
      claudeConfigDir: string;
      expiresAt: string;
      provider: 'claude-code';
      status: 'installed';
      token: string;
    }
  | { codexHome: string; provider: 'codex'; status: 'installed' };

const readJson = async (file: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    return null;
  }
};

export const readInstalledAgentCredential = async (
  provider: DeviceAgentCredentialProvider,
  options: AgentCredentialStoreOptions,
): Promise<InstalledAgentCredential> => {
  const paths = agentCredentialPaths(options.rootDir, provider);
  const metadata = (await readJson(paths.metadataFile)) as Partial<StoredMetadata> | null;
  if (metadata === undefined) {
    // A Codex secret without its metadata is a damaged install, not "none":
    // treating it as missing would run on the device's own login instead.
    if (provider === 'codex' && (await fileExists(paths.codexAuthFile))) {
      return { status: 'invalid' };
    }
    return { status: 'missing' };
  }
  if (!metadata || metadata.provider !== provider) return { status: 'invalid' };

  if (provider === 'claude-code') {
    if (
      typeof metadata.token !== 'string' ||
      !metadata.token ||
      typeof metadata.expiresAt !== 'string' ||
      Number.isNaN(Date.parse(metadata.expiresAt))
    ) {
      return { status: 'invalid' };
    }
    return {
      claudeConfigDir: paths.claudeConfigDir,
      expiresAt: metadata.expiresAt,
      provider,
      status: 'installed',
      token: metadata.token,
    };
  }

  if (!(await fileExists(paths.codexAuthFile))) return { status: 'invalid' };
  return { codexHome: paths.codexHome, provider, status: 'installed' };
};

export const isAgentCredentialExpired = (expiresAt: string, now: number) =>
  Date.parse(expiresAt) <= now;
