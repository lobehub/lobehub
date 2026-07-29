import { agentQuotaService } from '@/services/agentQuota';

export interface QuotaAccountSpawnPlan {
  /** Account chosen for this run, when routing applied. */
  accountId?: string;
  /** Env overrides realizing the choice (spread before the agent's own env). */
  env: Record<string, string>;
  /** Real provider account id, for run→account usage attribution. */
  externalAccountId?: string;
  reason?: 'pinned' | 'balanced';
}

const NO_ROUTING: QuotaAccountSpawnPlan = { env: {} };

/**
 * Resolve which provider account this agent should run on and turn the choice
 * into spawn env. The mapping mirrors how the CLI itself scopes logins:
 *
 * - `config-dir` account → `CLAUDE_CONFIG_DIR=<dir>` (an isolated CLI profile);
 * - `keychain` / `default-file` account → no override, the default login is it;
 * - `managed` accounts (cloud-held token) are not runnable locally yet;
 * - no bindings / quota service unreachable → `{}`, spawn behaves as before.
 *
 * The result is spread BEFORE `heterogeneousProvider.env`: an env the user put
 * on the agent explicitly is a stronger, more specific choice than pool
 * routing, and must keep winning.
 */
export const resolveQuotaAccountSpawnPlan = async (
  agentId: string | undefined,
  adapterType: string,
): Promise<QuotaAccountSpawnPlan> => {
  // Codex accounts exist in the DB but have no runnable credential mapping yet.
  if (adapterType !== 'claude-code' || !agentId) return NO_ROUTING;

  const selection = await agentQuotaService.selectAccountForAgent(agentId).catch(() => null);
  if (!selection) return NO_ROUTING;

  const attribution = {
    accountId: selection.accountId,
    externalAccountId: selection.externalAccountId ?? undefined,
    reason: selection.reason,
  };

  if (selection.credentialMode !== 'referenced') return { ...attribution, env: {} };

  const ref = selection.credentialRef;
  if (ref?.origin === 'config-dir' && ref.configDir) {
    return { ...attribution, env: { CLAUDE_CONFIG_DIR: ref.configDir } };
  }

  // Default login (keychain / ~/.claude): nothing to override.
  return { ...attribution, env: {} };
};
