import {
  type AgentCredentialStoreOptions,
  isAgentCredentialExpired,
  readInstalledAgentCredential,
} from './store';

/**
 * Env that would otherwise outrank `CLAUDE_CODE_OAUTH_TOKEN`: an API key or
 * bearer token, a proxy base URL, or a third-party cloud backend. A run on an
 * installed credential drops them so it cannot quietly bill something else.
 */
export const CLAUDE_CODE_CREDENTIAL_OVERRIDDEN_ENV = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_VERTEX',
] as const;

/** `codex exec` prefers this API key over the `auth.json` login. */
export const CODEX_CREDENTIAL_OVERRIDDEN_ENV = ['CODEX_API_KEY'] as const;

export type AgentCredentialSpawnEnv =
  /** No credential installed for this agent: spawn as before. */
  | { kind: 'none' }
  /** Spawn with `env` set and every `unsetEnv` key removed from the inherited env. */
  | { env: Record<string, string>; kind: 'spawn'; unsetEnv: string[] }
  /** A credential is installed but unusable: fail the run, never fall back. */
  | { kind: 'reject'; reason: string };

const NONE: AgentCredentialSpawnEnv = { kind: 'none' };

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
  options: AgentCredentialStoreOptions,
): Promise<AgentCredentialSpawnEnv> => {
  if (agentType !== 'claude-code' && agentType !== 'codex') return NONE;

  const credential = await readInstalledAgentCredential(agentType, options).catch(
    () => ({ status: 'invalid' }) as const,
  );
  const label = agentType === 'claude-code' ? 'Claude Code' : 'Codex';
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
    return {
      env: {
        CLAUDE_CODE_OAUTH_TOKEN: credential.token,
        CLAUDE_CONFIG_DIR: credential.claudeConfigDir,
      },
      kind: 'spawn',
      unsetEnv: [...CLAUDE_CODE_CREDENTIAL_OVERRIDDEN_ENV],
    };
  }

  return {
    env: { CODEX_HOME: credential.codexHome },
    kind: 'spawn',
    unsetEnv: [...CODEX_CREDENTIAL_OVERRIDDEN_ENV],
  };
};
