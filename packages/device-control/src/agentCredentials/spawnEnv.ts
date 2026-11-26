import { existsSync } from 'node:fs';
import path from 'node:path';

import { seedClaudeProfile, seedCodexProfile } from './profile';
import { AGENT_CREDENTIAL_RUN_DIR_ENV } from './runLease';
import {
  agentCredentialRunDirFor,
  type AgentCredentialStoreOptions,
  isAgentCredentialExpired,
  readInstalledAgentCredential,
} from './store';

/**
 * Env that would otherwise outrank `CLAUDE_CODE_OAUTH_TOKEN`: an API key or
 * bearer token, a proxy base URL, or a third-party cloud backend. A run on an
 * installed credential drops them so it cannot quietly bill something else.
 */
const CLAUDE_CODE_CREDENTIAL_OVERRIDDEN_ENV = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_VERTEX',
] as const;

/**
 * API keys that would authenticate (and bill) instead of the `auth.json`
 * login: `codex exec` prefers `CODEX_API_KEY`, and `OPENAI_API_KEY` reaches
 * the OpenAI provider. The managed Desktop Codex driver drops it too.
 */
const CODEX_CREDENTIAL_OVERRIDDEN_ENV = ['CODEX_API_KEY', 'OPENAI_API_KEY'] as const;

export type AgentCredentialSpawnEnv =
  /** No credential installed for this agent: spawn as before. */
  | { kind: 'none' }
  /** Spawn with `env` set and every `unsetEnv` key removed from the inherited env. */
  | { env: Record<string, string>; kind: 'spawn'; unsetEnv: string[] }
  /** A credential is installed but unusable: fail the run, never fall back. */
  | { kind: 'reject'; reason: string };

const NONE: AgentCredentialSpawnEnv = { kind: 'none' };

export interface ResolveAgentCredentialSpawnEnvOptions extends AgentCredentialStoreOptions {
  /** Home directory override for tests. */
  homeDir?: string;
  /** Env the agent would inherit; locates the user's own config to seed from. */
  inheritedEnv?: Record<string, string | undefined>;
}

/**
 * Turn the credential installed for `agentType` into spawn env for its run.
 *
 * Precedence: an installed credential wins over the device's own logins and
 * over server account routing, because the server installed it for exactly
 * this purpose. An expired or damaged credential rejects the run instead of
 * letting it fall back to whatever login the device happens to hold; removing
 * the credential restores the device's own login.
 */
export const resolveAgentCredentialSpawnEnv = async (
  agentType: string,
  options: ResolveAgentCredentialSpawnEnvOptions,
): Promise<AgentCredentialSpawnEnv> => {
  if (agentType !== 'claude-code' && agentType !== 'codex') return NONE;
  // The common case is no credential at all: answer it without async I/O, so
  // a spawn on a device that never had one is not delayed by a file read.
  if (!existsSync(path.join(options.rootDir, agentType))) return NONE;

  const credential = await readInstalledAgentCredential(agentType, options).catch(
    () => ({ status: 'invalid' }) as const,
  );
  const label = agentType === 'claude-code' ? 'Claude Code' : 'Codex';
  const seed = { env: options.inheritedEnv ?? process.env, homeDir: options.homeDir };
  if (credential.status === 'missing') return NONE;
  if (credential.status === 'invalid') {
    return {
      kind: 'reject',
      reason: `The ${label} credential installed on this device is unreadable. Reinstall it from LobeHub, or remove it to use this device's own login.`,
    };
  }

  if (credential.provider === 'claude-code') {
    const now = options.now?.() ?? Date.now();
    if (isAgentCredentialExpired(credential.expiresAt, now)) {
      return {
        kind: 'reject',
        reason: `The Claude Code credential installed on this device expired at ${credential.expiresAt}. Reinstall it from LobeHub, or remove it to use this device's own login.`,
      };
    }
    await seedClaudeProfile(credential.claudeConfigDir, seed);
    return {
      env: {
        CLAUDE_CODE_OAUTH_TOKEN: credential.token,
        CLAUDE_CONFIG_DIR: credential.claudeConfigDir,
      },
      kind: 'spawn',
      unsetEnv: [...CLAUDE_CODE_CREDENTIAL_OVERRIDDEN_ENV],
    };
  }

  try {
    await seedCodexProfile(credential.codexHome, seed);
  } catch {
    return {
      kind: 'reject',
      reason: `Could not prepare the Codex profile for the credential installed on this device. Reinstall it from LobeHub, or remove it to use this device's own login.`,
    };
  }
  return {
    env: {
      // The run wrapper leases the login here, so replacing it can stop runs
      // that would otherwise write the old login back (see `runLease.ts`).
      [AGENT_CREDENTIAL_RUN_DIR_ENV]: agentCredentialRunDirFor(options.rootDir, 'codex'),
      CODEX_HOME: credential.codexHome,
    },
    kind: 'spawn',
    unsetEnv: [...CODEX_CREDENTIAL_OVERRIDDEN_ENV],
  };
};
