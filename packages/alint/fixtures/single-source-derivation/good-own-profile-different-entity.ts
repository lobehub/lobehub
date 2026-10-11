// Fixture: the quota sampler spawns nothing. It resolves the profile dir once and,
// when none is configured, reads the user's own default login on purpose — a
// different entity from any child's HOME (quota-sampler/claudeCodeQuota.ts).
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export interface FetchClaudeCodeQuotaOptions {
  claudeConfigDirPath?: string | null;
  env?: Record<string, string | undefined>;
}

const asNonEmpty = (value: string | null | undefined): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

/** The config dir the CLI would resolve: the explicit option, the agent env, then the process env. */
const resolveExplicitConfigDir = (options: FetchClaudeCodeQuotaOptions): string | null =>
  asNonEmpty(options.claudeConfigDirPath) ??
  asNonEmpty(options.env?.CLAUDE_CONFIG_DIR) ??
  asNonEmpty(process.env.CLAUDE_CONFIG_DIR);

const readJson = async (file: string) => {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
};

export const readClaudeCredentials = async (options: FetchClaudeCodeQuotaOptions) => {
  const explicitDir = resolveExplicitConfigDir(options);
  if (explicitDir) return readJson(path.join(explicitDir, '.credentials.json'));

  // No custom profile: the user's own default login, not an agent's environment.
  return readJson(path.join(homedir(), '.claude', '.credentials.json'));
};

export const readClaudeAccountIdentity = async (options: FetchClaudeCodeQuotaOptions) => {
  const explicitDir = resolveExplicitConfigDir(options);
  const file = explicitDir
    ? path.join(explicitDir, '.claude.json')
    : path.join(homedir(), '.claude.json');
  return readJson(file);
};
