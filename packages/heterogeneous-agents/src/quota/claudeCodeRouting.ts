/**
 * Boolean-ish flags that route Claude Code to a third-party provider (AWS
 * Bedrock / Mantle / Google Vertex), billed there with no Anthropic
 * subscription login involved.
 */
export const CLAUDE_CODE_EXTERNAL_ROUTING_ENV_KEYS = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_VERTEX',
] as const;

export type ClaudeCodeExternalRoutingEnvKey =
  (typeof CLAUDE_CODE_EXTERNAL_ROUTING_ENV_KEYS)[number];

/** The CLI reads these as booleans, so "0" / "false" must not count as enabled. */
export const isClaudeCodeRoutingFlagEnabled = (value: string | undefined): boolean =>
  !!value?.trim() && !['0', 'false'].includes(value.trim().toLowerCase());

/**
 * Whether a run goes to an external provider, given the agent's configured
 * env and the flags it inherits. The agent's value wins per key — even to
 * switch an inherited flag off — and the inherited value fills the gaps. The
 * web app's account routing decides with it; the quota sampler applies the
 * same rule per key.
 */
export const claudeCodeRoutesExternally = (
  agentEnv: Record<string, string | undefined> | undefined,
  inheritedEnv: Record<string, string | undefined> = {},
): boolean =>
  CLAUDE_CODE_EXTERNAL_ROUTING_ENV_KEYS.some((key) =>
    isClaudeCodeRoutingFlagEnabled(agentEnv && key in agentEnv ? agentEnv[key] : inheritedEnv[key]),
  );

/**
 * Agent env keys that already choose which login (or credential) the CLI
 * uses. With any of these set, subscription account routing could only be
 * overridden — or, worse, block the run over a pin the agent does not use.
 */
export const CLAUDE_CODE_AGENT_LOGIN_ENV_KEYS = [
  'CLAUDE_CONFIG_DIR',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
] as const;

/** Whether the agent's own env decides the login, so account routing must stay out. */
export const claudeCodeAgentEnvPicksLogin = (
  agentEnv: Record<string, string | undefined> | undefined,
): boolean =>
  CLAUDE_CODE_AGENT_LOGIN_ENV_KEYS.some((key) => agentEnv?.[key]?.trim()) ||
  claudeCodeRoutesExternally(agentEnv);

/** One account the server routed a device run to. */
export interface ClaudeCodeRoutedAccount {
  externalAccountId: string;
  /** Display name for errors: the account label, else its email. */
  name?: string;
}

/**
 * The account choice the server sends with a device run. The server knows the
 * agent's bindings and every account's quota; only the device knows which of
 * those accounts it holds a login for, so it makes the final pick.
 *
 * - `pinned`: the run must use `candidates[0]`, or not run at all.
 * - `balanced`: the run uses the first candidate (best headroom first) the
 *   device holds a login for.
 */
export interface ClaudeCodeAccountRouting {
  candidates: ClaudeCodeRoutedAccount[];
  mode: 'balanced' | 'pinned';
}

interface RoutableLogin {
  identity: { externalAccountId?: string | null };
}

export type ClaudeCodeRoutedLogin<T extends RoutableLogin = RoutableLogin> =
  /** Spawn with this login. */
  | { account: ClaudeCodeRoutedAccount; kind: 'login'; login: T }
  /** Leave the spawn on the device's default login, as before routing existed. */
  | { kind: 'default' }
  /** The pinned account has no login on this device: the run must not start. */
  | { account: ClaudeCodeRoutedAccount; kind: 'pinned-missing' };

/**
 * Map the server's account choice onto the logins one device holds. A pin
 * never falls back to another login. Auto mode with none of its accounts here
 * keeps the default login: the rotation may be built from other machines'
 * logins, and that must not stop a device that ran fine before routing.
 */
export const pickClaudeCodeLogin = <T extends RoutableLogin>(
  routing: ClaudeCodeAccountRouting,
  localAccounts: T[],
): ClaudeCodeRoutedLogin<T> => {
  const candidates =
    routing.mode === 'pinned' ? routing.candidates.slice(0, 1) : routing.candidates;

  for (const account of candidates) {
    const login = localAccounts.find(
      (local) => local.identity.externalAccountId === account.externalAccountId,
    );
    if (login) return { account, kind: 'login', login };
  }

  if (routing.mode === 'pinned' && routing.candidates[0])
    return { account: routing.candidates[0], kind: 'pinned-missing' };

  return { kind: 'default' };
};
