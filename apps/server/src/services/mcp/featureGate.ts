import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

/**
 * Whether MCP Apps are on for this user (runtime flag `mcp_app`, off by
 * default). Off: MCP sessions don't advertise the extension and tool calls
 * don't look up a `ui://` view, so servers answer exactly as they did before.
 *
 * Never fails the tool call it gates: a flag that can't be read counts as off.
 */
export const isMcpAppEnabled = async (userId?: string | null): Promise<boolean> => {
  try {
    return (
      (await getServerFeatureFlagsStateFromRuntimeConfig(userId ?? undefined)).enableMcpApp === true
    );
  } catch (error) {
    console.error('[MCPApp] Failed to read the mcp_app feature flag:', error);
    return false;
  }
};
