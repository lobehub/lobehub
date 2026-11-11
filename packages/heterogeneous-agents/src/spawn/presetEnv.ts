import {
  CLAUDE_CODE_ENTRYPOINT_ENV,
  dropClearedClaudeCodeEntrypoint,
} from '../claudeCodeEntrypoint';

/**
 * Environment variables a host always sets for a heterogeneous agent, shared by
 * every spawn site (desktop CLI/SDK runs, `lh hetero exec`). Hosts apply them
 * over the inherited environment and under the agent's configured `env`, so an
 * explicit per-agent setting still wins.
 */
const HETEROGENEOUS_AGENT_PRESET_ENV: Partial<Record<string, Readonly<Record<string, string>>>> = {
  /**
   * Headless Claude Code (`-p`, also the Agent SDK) starts the first model call
   * without waiting for MCP servers, and claude.ai connectors (Microsoft 365,
   * Gmail, ...) connect last because their list is fetched from claude.ai first.
   * Our runs send the prompt at spawn and usually exit after one turn, so those
   * tools never reach the model. Waiting costs about 1.5s per turn and is
   * capped by `MCP_CONNECT_TIMEOUT_MS` (5s by default) when a server hangs.
   */
  'claude-code': { MCP_CONNECTION_NONBLOCKING: 'false' },
  /** A one-shot print-mode process cannot reliably service background tasks. */
  'codebuddy': { CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS: '1' },
};

/**
 * @param agentEnv the agent's configured `env`, which the host applies over
 * the result. Presets that only make sense next to a setting the agent chose
 * are derived from it.
 */
const getHeterogeneousAgentPresetEnv = (
  agentType: string,
  agentEnv?: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> => {
  const preset = HETEROGENEOUS_AGENT_PRESET_ENV[agentType] ?? {};
  // An agent that picks its own entrypoint also gets the terminal title off.
  if (agentType === 'claude-code' && agentEnv?.[CLAUDE_CODE_ENTRYPOINT_ENV]?.trim()) {
    return { ...preset, CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1' };
  }
  return preset;
};

/**
 * The environment a host spawns a run with: what it inherited, then the
 * presets, then the agent's own `env` on top. An entrypoint the agent cleared
 * is removed from the result, so an inherited one does not stand in for it.
 */
export const getHeterogeneousAgentSpawnEnv = <T extends Record<string, string | undefined>>(
  agentType: string,
  agentEnv?: Readonly<Record<string, string>>,
  inheritedEnv?: T,
): T =>
  dropClearedClaudeCodeEntrypoint({
    ...inheritedEnv,
    ...getHeterogeneousAgentPresetEnv(agentType, agentEnv),
    ...agentEnv,
  } as T);
