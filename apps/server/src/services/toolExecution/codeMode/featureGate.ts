import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

/**
 * Whether MCP Code Mode is on for this user (runtime flag `mcp_code_mode`,
 * off by default). Off: connector tools are offered one function each, exactly
 * as before Code Mode existed.
 *
 * Never fails the run it gates: a flag that can't be read counts as off.
 */
export const isMcpCodeModeEnabled = async (userId?: string | null): Promise<boolean> => {
  try {
    return (
      (await getServerFeatureFlagsStateFromRuntimeConfig(userId ?? undefined)).enableMcpCodeMode ===
      true
    );
  } catch (error) {
    console.error('[CodeMode] Failed to read the mcp_code_mode feature flag:', error);
    return false;
  }
};
