export const CLAUDE_CODE_ENTRYPOINT_ENV = 'CLAUDE_CODE_ENTRYPOINT';
export const DEFAULT_CLAUDE_CODE_ENTRYPOINT = 'lobehub';

const ENTRYPOINT_PATTERN = /^[\w.-]{1,64}$/;

/**
 * The entrypoint name an agent may report, or `undefined` when unset or not a
 * plain identifier. A dispatched run carries this value to another machine,
 * so anything else is dropped instead of reaching a process environment.
 */
export const normalizeClaudeCodeEntrypoint = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return;
  const entrypoint = value.trim();
  return ENTRYPOINT_PATTERN.test(entrypoint) ? entrypoint : undefined;
};

/**
 * What a dispatched run carries for the agent's setting: the name, an empty
 * string when the agent turned it off (so the receiving host clears one it
 * inherited), or `undefined` when the agent never set it.
 */
export const resolveDispatchedClaudeCodeEntrypoint = (
  agentEnv: Readonly<Record<string, string>> | undefined,
): string | undefined => {
  const value = agentEnv?.[CLAUDE_CODE_ENTRYPOINT_ENV];
  return value === undefined ? undefined : (normalizeClaudeCodeEntrypoint(value) ?? '');
};

/**
 * Env a host adds for a dispatched Claude Code run. A name is reported as the
 * entrypoint; headless Claude Code reports `sdk-cli`, and under any other
 * entrypoint it spends an extra model request naming a terminal title nothing
 * reads, so that is turned off. Any other string clears the variable: it is
 * set empty here and removed where the CLI is spawned.
 */
export const buildClaudeCodeEntrypointEnv = (value: unknown): Record<string, string> => {
  if (typeof value !== 'string') return {};
  const entrypoint = normalizeClaudeCodeEntrypoint(value);
  if (!entrypoint) return { [CLAUDE_CODE_ENTRYPOINT_ENV]: '' };
  return { CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1', [CLAUDE_CODE_ENTRYPOINT_ENV]: entrypoint };
};

/**
 * Removes an entrypoint the agent cleared. Agent config saves merge, so a
 * turned-off setting is stored as an empty value; passing that on would hand
 * Claude Code an empty entrypoint instead of letting it report its own.
 */
export const dropClearedClaudeCodeEntrypoint = <T extends Record<string, string | undefined>>(
  env: T,
): T => {
  if (env[CLAUDE_CODE_ENTRYPOINT_ENV]?.trim() === '') delete env[CLAUDE_CODE_ENTRYPOINT_ENV];
  return env;
};
