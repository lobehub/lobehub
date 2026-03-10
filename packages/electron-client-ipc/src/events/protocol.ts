import type { McpInstallSchema } from '../types';

/**
 * Protocol installation related Broadcast events (main process -> renderer process)
 */
export interface ProtocolBroadcastEvents {
  /**
   * MCP plugin installation request event
   * Sent to frontend after main process parses protocol URL
   */
  mcpInstallRequest: (data: {
    /** Market source ID */
    marketId?: string;
    /** Plugin ID */
    pluginId: string;
    /** MCP Schema 对象 */
    schema: McpInstallSchema;
  }) => void;
}
