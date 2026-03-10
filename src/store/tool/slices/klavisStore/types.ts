/**
 * Klavis Server connection status
 */
export enum KlavisServerStatus {
  /** Connected and ready to use */
  CONNECTED = 'connected',
  /** Connection failed */
  ERROR = 'error',
  /** Not authenticated, needs OAuth flow completion */
  PENDING_AUTH = 'pending_auth',
}

/**
 * Klavis tool definition (MCP format)
 */
export interface KlavisTool {
  /** Tool description */
  description?: string;
  /** JSON Schema for tool input */
  inputSchema: {
    properties?: Record<string, any>;
    required?: string[];
    type: string;
  };
  /** Tool name */
  name: string;
}

/**
 * Klavis Server instance
 */
export interface KlavisServer {
  /** Creation timestamp */
  createdAt: number;
  /** Error message (if any) */
  errorMessage?: string;
  /** Server icon URL */
  icon?: string;
  /**
   * Identifier for storing to database (e.g., 'google-calendar')
   * Format: lowercase, spaces replaced with hyphens
   */
  identifier: string;
  /** Klavis instance ID */
  instanceId: string;
  /** Whether authenticated */
  isAuthenticated: boolean;
  /** OAuth authentication URL */
  oauthUrl?: string;
  /**
   * Server name for calling Klavis API (e.g., 'Google Calendar')
   */
  serverName: string;
  /** Server URL (for connection and tool calling) */
  serverUrl: string;
  /** Connection status */
  status: KlavisServerStatus;
  /** List of tools provided by server */
  tools?: KlavisTool[];
}

/**
 * Parameters for creating Klavis Server
 */
export interface CreateKlavisServerParams {
  /**
   * Identifier for storing to database (e.g., 'google-calendar')
   */
  identifier: string;
  /**
   * Server name for calling Klavis API (e.g., 'Google Calendar')
   */
  serverName: string;
  /** User ID */
  userId: string;
}

/**
 * Parameters for calling Klavis tool
 */
export interface CallKlavisToolParams {
  /** Strata Server URL */
  serverUrl: string;
  /** Tool arguments */
  toolArgs?: Record<string, unknown>;
  /** Tool name */
  toolName: string;
}

/**
 * Result of calling Klavis tool
 */
export interface CallKlavisToolResult {
  /** Return data */
  data?: any;
  /** Error message */
  error?: string;
  /** Whether successful */
  success: boolean;
}
