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

/** Top-level Codex config keys that pick a login method or credential store. */
const CODEX_AUTH_CONFIG_KEYS = [
  'cli_auth_credentials_store',
  'forced_chatgpt_workspace_id',
  'forced_login_method',
  'preferred_auth_method',
];

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

/**
 * Point `managedDir/name` at `sourceDir/name`. A link this module made is
 * refreshed; a real file or directory the agent created in the profile is
 * left alone; a link whose source disappeared is removed.
 */
const linkEntry = async (sourceDir: string, managedDir: string, name: string) => {
  const source = path.join(sourceDir, name);
  const target = path.join(managedDir, name);
  const [sourceStat, targetStat] = await Promise.all([
    lstatOrUndefined(source),
    lstatOrUndefined(target),
  ]);
  if (targetStat && !targetStat.isSymbolicLink()) return;
  if (targetStat) await rm(target, { force: true });
  if (!sourceStat) return;

  if (process.platform === 'win32') {
    // File symlinks need a privilege on Windows: junction dirs, copy files.
    if (sourceStat.isDirectory()) await symlink(source, target, 'junction');
    else await copyFile(source, target);
    return;
  }
  await symlink(source, target);
};

const bestEffort = async (work: () => Promise<unknown>) => {
  try {
    await work();
  } catch {
    // A missing or unreadable piece of user config must not block the run.
  }
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

  for (const name of CLAUDE_LINKED_ENTRIES) {
    await bestEffort(() => linkEntry(user.configDir, managedDir, name));
  }

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

/** Drop top-level auth / credential-store keys, then pin the file store. */
export const buildManagedCodexConfig = (userConfig: string | undefined) => {
  const kept: string[] = [];
  let topLevel = true;
  for (const line of (userConfig ?? '').split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) topLevel = false;
    const key = /^\s*([\w-]+)\s*=/.exec(line)?.[1];
    if (topLevel && key && CODEX_AUTH_CONFIG_KEYS.includes(key)) continue;
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

  for (const name of CODEX_LINKED_ENTRIES) {
    await bestEffort(() => linkEntry(userHome, managedHome, name));
  }
};
