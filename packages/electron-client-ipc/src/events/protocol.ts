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
    /** MCP Schema object */
    schema: McpInstallSchema;
  }) => void;

  /**
   * A shell launch asked the app to open a directory (`lh app .`, `LobeHub
   * ~/Code/app`, Finder's "Open With", `lobehub://open/path?path=…`).
   *
   * Only the canonical path travels: the renderer decides what "open" means
   * (reveal the latest conversation bound to it, or start one), because that
   * decision needs the user's project and topic data, which only it can read.
   */
  openDirectory: (data: {
    /**
     * Focus a new window instead of the conversation already bound to this
     * directory. `lh app --new-window` sets it.
     */
    newWindow: boolean;
    /** Absolute, symlink-resolved directory path. */
    path: string;
  }) => void;
}
