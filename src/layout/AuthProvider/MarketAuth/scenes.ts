/**
 * Market Auth Scenes
 *
 * The Market auth modal can be triggered from different capabilities (running a
 * tool in the sandbox, installing a Cloud MCP skill, ...). The `scene` lets the modal show capability-specific copy
 * while falling back to the generic community-profile copy when unknown.
 */

export type MarketAuthScene = 'default' | 'sandbox' | 'mcp';

/**
 * Infer the scene from a tRPC procedure path (e.g. `market.execInSandbox`).
 * Used by the 401 error link where only the request path is available.
 */
export const pathToMarketAuthScene = (path: string): MarketAuthScene => {
  if (path.includes('execInSandbox')) return 'sandbox';
  if (path.includes('CloudMcp') || path.includes('callCloudMcpEndpoint')) return 'mcp';
  return 'default';
};
