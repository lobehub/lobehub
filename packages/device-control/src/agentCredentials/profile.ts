import { randomUUID } from 'node:crypto';
import { chmod, copyFile, lstat, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Seed the managed profile a credential run uses (`CLAUDE_CONFIG_DIR` /
 * `CODEX_HOME`) from the user's own, non-secret config, so the run keeps the
 * user's instructions, skills, plugins and MCP servers while authenticating
 * only with the installed credential.
 *
 * Runs before every spawn, so edits to the user's config reach the next run.
 * Each piece is best-effort except the Codex credential-store pin, which the
 * installed login depends on.
 */

const FILE_MODE = 0o600;

type Env = Record<string, string | undefined>;

export interface SeedProfileOptions {
  /** Env the spawned agent inherits; decides where the user's own config is. */
  env: Env;
  /** Home directory override for tests. */
  homeDir?: string;
}

/** Env keys in Claude Code `settings.json` that would choose another login. */
const CLAUDE_SETTINGS_AUTH_ENV = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CONFIG_DIR',
]);

/** `settings.json` keys that run a helper to mint other credentials. */
const CLAUDE_SETTINGS_AUTH_KEYS = ['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport'];

/** Linked so the run sees the user's live copies. */
const CLAUDE_LINKED_ENTRIES = ['CLAUDE.md', 'agents', 'commands', 'plugins', 'skills'];
const CODEX_LINKED_ENTRIES = ['AGENTS.md', 'prompts', 'skills'];

/**
 * Top-level Codex config keys that pick a login method, a credential store,
 * or a provider (directly, or through a profile) that could authenticate and
 * bill somewhere other than the installed `auth.json`.
 */
const CODEX_AUTH_CONFIG_KEYS = [
  'cli_auth_credentials_store',
  'forced_chatgpt_workspace_id',
  'forced_login_method',
  'model_provider',
  'preferred_auth_method',
  'profile',
];

/** A TOML table header: `[a.b]` or `[[a.b]]`. */
const TOML_TABLE_HEADER = /^\s*\[\[?\s*([^[\]]+?)\s*\]\]?\s*(?:#.*)?$/;

/** Custom provider definitions; the managed run only uses the built-in one. */
const isCodexProviderPath = (dottedPath: string) =>
  /^["']?model_providers["']?(?:\s*\.|$)/.test(dottedPath);

/** Profiles stay, minus the provider they would switch to. */
const isCodexProfileTable = (dottedPath: string) => /^["']?profiles["']?\s*\./.test(dottedPath);

/**
 * Names of the instruction files copied (not linked) on Windows, with the
 * copy's mtime, so a later seed refreshes an untouched copy but never one the
 * agent edited.
 */
const COPIED_ENTRIES_FILE = '.lobehub-copied-entries.json';

const CODEX_CREDENTIAL_STORE_PIN = 'cli_auth_credentials_store = "file"';

const lstatOrUndefined = (target: string) => lstat(target).catch(() => undefined);

const writePrivate = async (file: string, content: string) => {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, content, { encoding: 'utf8', mode: FILE_MODE });
    await chmod(temp, FILE_MODE);
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
};

const readJsonObject = async (file: string): Promise<Record<string, unknown> | undefined> => {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const bestEffort = async (work: () => Promise<unknown>) => {
  try {
    await work();
  } catch {
    // A missing or unreadable piece of user config must not block the run.
  }
};

type CopiedEntries = Record<string, number>;

const readCopiedEntries = async (managedDir: string): Promise<CopiedEntries> => {
  const stored = await readJsonObject(path.join(managedDir, COPIED_ENTRIES_FILE));
  const entries: CopiedEntries = {};
  for (const [name, mtime] of Object.entries(stored ?? {})) {
    if (typeof mtime === 'number') entries[name] = mtime;
  }
  return entries;
};

/**
 * Point `managedDir/name` at `sourceDir/name`. A link (or Windows copy) this
 * module made is refreshed; a real file or directory the agent created or
 * edited in the profile is left alone; an entry whose source disappeared is
 * removed. `copied` tracks the Windows copies and is updated in place.
 */
const linkEntry = async (
  sourceDir: string,
  managedDir: string,
  name: string,
  copied: CopiedEntries,
) => {
  const source = path.join(sourceDir, name);
  const target = path.join(managedDir, name);
  const [sourceStat, targetStat] = await Promise.all([
    lstatOrUndefined(source),
    lstatOrUndefined(target),
  ]);
  const ownCopy = !!targetStat?.isFile() && copied[name] === targetStat.mtimeMs;
  if (targetStat && !targetStat.isSymbolicLink() && !ownCopy) {
    delete copied[name];
    return;
  }
  if (targetStat) await rm(target, { force: true });
  delete copied[name];
  if (!sourceStat) return;

  if (process.platform === 'win32') {
    // File symlinks need a privilege on Windows: junction dirs, copy files.
    if (sourceStat.isDirectory()) {
      await symlink(source, target, 'junction');
    } else {
      await copyFile(source, target);
      copied[name] = (await lstat(target)).mtimeMs;
    }
    return;
  }
  await symlink(source, target);
};

const linkEntries = async (sourceDir: string, managedDir: string, names: string[]) => {
  const copied = await readCopiedEntries(managedDir);
  const before = JSON.stringify(copied);
  for (const name of names) {
    await bestEffort(() => linkEntry(sourceDir, managedDir, name, copied));
  }
  if (JSON.stringify(copied) === before) return;
  await bestEffort(() =>
    writePrivate(path.join(managedDir, COPIED_ENTRIES_FILE), JSON.stringify(copied)),
  );
};

const isSameDir = (a: string, b: string) => path.resolve(a) === path.resolve(b);

/** The user's own Claude Code config dir and `.claude.json`. */
const userClaudePaths = (
  managedDir: string,
  { env, homeDir = os.homedir() }: SeedProfileOptions,
) => {
  const configured = env.CLAUDE_CONFIG_DIR?.trim();
  if (configured && !isSameDir(configured, managedDir)) {
    return { configDir: configured, stateFile: path.join(configured, '.claude.json') };
  }
  return {
    configDir: path.join(homeDir, '.claude'),
    stateFile: path.join(homeDir, '.claude.json'),
  };
};

export const seedClaudeProfile = async (managedDir: string, options: SeedProfileOptions) => {
  const user = userClaudePaths(managedDir, options);

  await bestEffort(async () => {
    const settings = await readJsonObject(path.join(user.configDir, 'settings.json'));
    const target = path.join(managedDir, 'settings.json');
    if (!settings) {
      await rm(target, { force: true });
      return;
    }
    for (const key of CLAUDE_SETTINGS_AUTH_KEYS) delete settings[key];
    if (settings.env && typeof settings.env === 'object') {
      const env = { ...(settings.env as Record<string, unknown>) };
      for (const key of Object.keys(env)) if (CLAUDE_SETTINGS_AUTH_ENV.has(key)) delete env[key];
      settings.env = env;
    }
    await writePrivate(target, JSON.stringify(settings, null, 2));
  });

  await linkEntries(user.configDir, managedDir, CLAUDE_LINKED_ENTRIES);

  // User-scope MCP servers live in `.claude.json` beside session state and
  // the account record; copy only `mcpServers` into the profile's own file.
  await bestEffort(async () => {
    const userState = await readJsonObject(user.stateFile);
    const target = path.join(managedDir, '.claude.json');
    const managedState = (await readJsonObject(target)) ?? {};
    const servers = userState?.mcpServers;
    const next = { ...managedState };
    if (servers && typeof servers === 'object') next.mcpServers = servers;
    else delete next.mcpServers;
    if (JSON.stringify(next) === JSON.stringify(managedState)) return;
    await writePrivate(target, JSON.stringify(next, null, 2));
  });
};

/**
 * Drop top-level auth / credential-store / provider keys, custom provider
 * tables and profile provider overrides, then pin the file store.
 */
export const buildManagedCodexConfig = (userConfig: string | undefined) => {
  const kept: string[] = [];
  let table: string | undefined;
  for (const line of (userConfig ?? '').split(/\r?\n/)) {
    const header = TOML_TABLE_HEADER.exec(line)?.[1];
    if (header !== undefined) table = header;
    const inProviderTable = table !== undefined && isCodexProviderPath(table);
    if (inProviderTable) continue;
    const key = /^\s*([\w"'.-]+?)\s*=/.exec(line)?.[1];
    if (key !== undefined && header === undefined) {
      if (table === undefined && (CODEX_AUTH_CONFIG_KEYS.includes(key) || isCodexProviderPath(key)))
        continue;
      if (table !== undefined && isCodexProfileTable(table) && key === 'model_provider') continue;
    }
    kept.push(line);
  }
  // Top-level keys must precede the first table, so the pin goes first.
  return `${CODEX_CREDENTIAL_STORE_PIN}\n${kept.join('\n').replace(/^\n+/, '')}`.trimEnd() + '\n';
};

export const seedCodexProfile = async (
  managedHome: string,
  { env, homeDir = os.homedir() }: SeedProfileOptions,
) => {
  const configured = env.CODEX_HOME?.trim();
  const userHome =
    configured && !isSameDir(configured, managedHome) ? configured : path.join(homeDir, '.codex');

  const userConfig = await readFile(path.join(userHome, 'config.toml'), 'utf8').catch(
    () => undefined,
  );
  // Not best-effort: without the pin a keyring default could hide auth.json.
  await writePrivate(path.join(managedHome, 'config.toml'), buildManagedCodexConfig(userConfig));

  await linkEntries(userHome, managedHome, CODEX_LINKED_ENTRIES);
};
