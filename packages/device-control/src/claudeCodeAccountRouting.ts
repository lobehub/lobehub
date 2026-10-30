import type {
  ClaudeCodeAccountResolution,
  ClaudeCodeAccountRouting,
  ClaudeCodeLocalAccount,
} from '@lobechat/heterogeneous-agents/quota';
import {
  claudeCodeRoutesExternally,
  pickClaudeCodeLogin,
} from '@lobechat/heterogeneous-agents/quota';
import {
  hasClaudeCodeLogin,
  readClaudeCodeIdentity,
} from '@lobechat/heterogeneous-agents/quota-sampler';

export interface ResolveClaudeAccountSpawnEnvDeps {
  /** Env the spawned CLI inherits on this device (Bedrock / Vertex flags). */
  inheritedEnv: Record<string, string | undefined>;
  /** Every Claude Code login this device holds, default first. */
  listLogins: () => Promise<ClaudeCodeLocalAccount[]>;
  /**
   * Make a profile login ready to spawn on (e.g. link its shared entries).
   * Omitted where the device has no per-account profiles.
   */
  prepareLogin?: (externalAccountId: string) => Promise<ClaudeCodeAccountResolution>;
}

export type ClaudeAccountSpawnEnv =
  { env: Record<string, string>; kind: 'spawn' } | { kind: 'reject'; reason: string };

const NO_OVERRIDE: ClaudeAccountSpawnEnv = { env: {}, kind: 'spawn' };

const notSignedIn = (name: string): ClaudeAccountSpawnEnv => ({
  kind: 'reject',
  reason: `The Claude Code account ${name} isn't signed in on this device. Sign in to it on this device, or switch to another account.`,
});

/**
 * Turn the account the server routed a device run to into spawn env for
 * `lh hetero exec`: `{}` keeps the device's default login, a profile login
 * sets `CLAUDE_CONFIG_DIR`. A pinned account this device holds no login for
 * rejects the run rather than quietly spending another account's quota.
 */
export const resolveClaudeAccountSpawnEnv = async (
  routing: ClaudeCodeAccountRouting | undefined,
  deps: ResolveClaudeAccountSpawnEnvDeps,
): Promise<ClaudeAccountSpawnEnv> => {
  if (!routing?.candidates.length) return NO_OVERRIDE;
  // A Bedrock / Vertex run uses no subscription login at all.
  if (claudeCodeRoutesExternally(undefined, deps.inheritedEnv)) return NO_OVERRIDE;

  const pinnedName = routing.candidates[0].name ?? routing.candidates[0].externalAccountId;
  let logins: ClaudeCodeLocalAccount[];
  try {
    logins = await deps.listLogins();
  } catch {
    // Auto mode may run on the default login; a pin may not run on a guess.
    return routing.mode === 'pinned' ? notSignedIn(pinnedName) : NO_OVERRIDE;
  }

  const picked = pickClaudeCodeLogin(routing, logins);
  if (picked.kind === 'pinned-missing') return notSignedIn(pinnedName);
  if (picked.kind === 'default' || !picked.login.configDir) return NO_OVERRIDE;

  if (!deps.prepareLogin)
    return { env: { CLAUDE_CONFIG_DIR: picked.login.configDir }, kind: 'spawn' };

  const resolution = await deps
    .prepareLogin(picked.account.externalAccountId)
    .catch((): ClaudeCodeAccountResolution => ({ kind: 'missing' }));
  if (resolution.kind === 'profile')
    return { env: { CLAUDE_CONFIG_DIR: resolution.configDir }, kind: 'spawn' };
  if (resolution.kind === 'default') return NO_OVERRIDE;
  // Signed out between the listing and the spawn.
  return routing.mode === 'pinned'
    ? notSignedIn(picked.account.name ?? picked.account.externalAccountId)
    : NO_OVERRIDE;
};

/**
 * The only login a plain CLI device holds: whatever `claude` uses with the
 * env it inherits (`CLAUDE_CONFIG_DIR`, else `~/.claude`).
 */
export const listDefaultClaudeLogin = async (
  env: Record<string, string | undefined>,
): Promise<ClaudeCodeLocalAccount[]> => {
  const identity = await readClaudeCodeIdentity({ env });
  if (!identity?.externalAccountId) return [];
  if (!(await hasClaudeCodeLogin({ env }))) return [];
  return [{ configDir: null, identity }];
};
