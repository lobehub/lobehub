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

export const getHeterogeneousAgentPresetEnv = (
  agentType: string,
): Readonly<Record<string, string>> => HETEROGENEOUS_AGENT_PRESET_ENV[agentType] ?? {};
