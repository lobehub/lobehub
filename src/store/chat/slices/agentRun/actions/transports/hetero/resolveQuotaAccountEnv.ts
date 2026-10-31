import {
  claudeCodeAgentEnvPicksLogin,
  claudeCodeRoutesExternally,
} from '@lobechat/heterogeneous-agents/quota';
import { t } from 'i18next';

import { agentQuotaService } from '@/services/agentQuota';
import { heterogeneousAgentService } from '@/services/electron/heterogeneousAgent';
import { getElectronStoreState } from '@/store/electron';

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

type AccountSelection = NonNullable<
  Awaited<ReturnType<typeof agentQuotaService.selectAccountForAgent>>
>;

/**
 * Where this desktop holds the chosen account's login. `null` = nothing to
 * map (a managed account, or no external id): the spawn keeps the default
 * login, as before routing existed. A failed lookup is NOT that — the run
 * fails instead of starting on a login nobody selected.
 */
const resolveLocalLogin = async (selection: AccountSelection) => {
  if (selection.credentialMode !== 'referenced' || !selection.externalAccountId) return null;
  try {
    return await heterogeneousAgentService.resolveClaudeCodeAccount(selection.externalAccountId);
  } catch (error) {
    console.error('[HeterogeneousAgent] Claude Code account resolution failed:', error);
    throw new Error(t('heteroAgent.claudeQuota.accountResolveFailed', { ns: 'chat' }), {
      cause: error,
    });
  }
};

/**
 * Bedrock / Mantle / Vertex flags the desktop process exports reach the CLI
 * too, unless the agent env overrides them — a run on an external provider
 * involves no subscription login at all. An older desktop without the IPC
 * reports none, so routing still applies there.
 */
const inheritedEnvRoutesExternally = async (agentEnv?: Record<string, string>) => {
  const inherited = await heterogeneousAgentService
    .getClaudeCodeInheritedRoutingEnv()
    .catch(() => ({}));
  return claudeCodeRoutesExternally(agentEnv, inherited);
};

/**
 * Resolve which provider account this agent should run on and turn the choice
 * into spawn env. Account rows are shared across devices, but a login is not,
 * so the choice is asked for THIS device (its own Manual pick wins) and the
 * desktop maps it to the login it holds here —
 *
 * - the default login → no override;
 * - the account's own profile → `CLAUDE_CONFIG_DIR=<profile>`;
 * - no local login → never falls back to an unselected login: this device's
 *   own pick names the missing login and fails the run; a legacy agent-wide
 *   pin (picked on another machine) and Auto mode re-select among the
 *   accounts this device can run; Auto fails when the rotation holds none,
 *   the legacy pin then spawns on the default login like an unbound agent.
 *
 * No bindings, or the quota service unreachable, → `{}` and the spawn behaves
 * as before; a desktop that fails to look up its logins fails the run. An env
 * that picks its own login or an external provider — the agent's
 * (`claudeCodeAgentEnvPicksLogin`) or one inherited from the desktop — wins over
 * routing; the result is also spread BEFORE `heterogeneousProvider.env` for
 * the same reason.
 */
export const resolveQuotaAccountSpawnPlan = async (
  agentId: string | undefined,
  adapterType: string,
  agentEnv?: Record<string, string>,
): Promise<QuotaAccountSpawnPlan> => {
  // Codex accounts exist in the DB but have no runnable credential mapping yet.
  if (adapterType !== 'claude-code' || !agentId) return NO_ROUTING;
  if (claudeCodeAgentEnvPicksLogin(agentEnv)) return NO_ROUTING;

  // Without a device id (signed out of the gateway) only agent-wide choices apply.
  const deviceId = await getElectronStoreState().resolveGatewayDeviceId();
  const select = (runnableExternalAccountIds?: string[]) =>
    agentQuotaService
      .selectAccountForAgent(agentId, {
        ...(deviceId && { deviceId }),
        provider: adapterType,
        ...(runnableExternalAccountIds && { runnableExternalAccountIds }),
      })
      .catch(() => null);

  // Unbound agents (the common case) stop here without touching local logins.
  let selection = await select();
  if (!selection) return NO_ROUTING;
  if (await inheritedEnvRoutesExternally(agentEnv)) return NO_ROUTING;

  let resolution = await resolveLocalLogin(selection);

  // Auto, or a pin made on another machine, picked an account this desktop has
  // no login for: pick again among the ones it has. (Listing first on every
  // run would cost unbound agents a Keychain read per profile for nothing.)
  // Only a legacy agent-wide pin is re-picked; this device's own pin (or one
  // from a server that predates per-device picks) stays strict.
  const strictPin = selection.reason === 'pinned' && selection.pinScope !== 'agent';
  if (resolution?.kind === 'missing' && !strictPin) {
    // The selected login is known to be absent here, so a failed listing must
    // stop the run — falling back would start it on a login nobody selected.
    const local = await heterogeneousAgentService.listClaudeCodeAccounts().catch((error) => {
      console.error('[HeterogeneousAgent] Claude Code account listing failed:', error);
      throw new Error(t('heteroAgent.claudeQuota.accountResolveFailed', { ns: 'chat' }), {
        cause: error,
      });
    });

    const runnable = local.flatMap((account) => account.identity.externalAccountId ?? []);
    const rebalanced = await select(runnable);
    // A pin made on another machine is not a choice for this one: with nothing
    // in the rotation it can run, this device behaves as if it had no binding
    // and spawns on its default login.
    if (!rebalanced && selection.pinScope === 'agent') return NO_ROUTING;
    // The listing just read every login, so map the new pick from it rather
    // than scanning the logins again.
    const login = rebalanced
      ? local.find((account) => account.identity.externalAccountId === rebalanced.externalAccountId)
      : undefined;
    if (!rebalanced || !login)
      throw new Error(t('heteroAgent.claudeQuota.noRunnableAccount', { ns: 'chat' }));

    selection = rebalanced;
    resolution = login.configDir
      ? { configDir: login.configDir, kind: 'profile' }
      : { kind: 'default' };
  }

  const attribution = {
    accountId: selection.accountId,
    externalAccountId: selection.externalAccountId ?? undefined,
    reason: selection.reason,
  };

  if (resolution?.kind === 'profile')
    return { ...attribution, env: { CLAUDE_CONFIG_DIR: resolution.configDir } };

  if (resolution?.kind === 'missing') {
    const pinnedId = selection.accountId;
    const account = await agentQuotaService
      .listAccounts()
      .then((accounts) => accounts.find((a) => a.id === pinnedId))
      .catch(() => undefined);
    throw new Error(
      t('heteroAgent.claudeQuota.accountNotSignedIn', {
        account: account?.label || account?.email || selection.externalAccountId,
        ns: 'chat',
      }),
    );
  }

  return { ...attribution, env: {} };
};
