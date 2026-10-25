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
