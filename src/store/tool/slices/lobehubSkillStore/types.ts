/**
 * LobeHub Skill Server connection status
 */
export enum LobehubSkillStatus {
  /** Connected and ready to use */
  CONNECTED = 'connected',
  /** Connecting */
  CONNECTING = 'connecting',
  /** Connection failed or token expired */
  ERROR = 'error',
  /** Not connected */
  NOT_CONNECTED = 'not_connected',
}

/**
 * LobeHub Skill Tool definition (from Market API)
 */
export interface LobehubSkillTool {
  /** Tool description */
  description?: string;
  /** JSON Schema for tool input */
  inputSchema: {
    additionalProperties?: boolean;
    properties?: Record<string, any>;
    required?: string[];
    type: string;
  };
  /** Tool name */
  name: string;
}

/**
 * LobeHub Skill Provider definition (from Market API)
 */
export interface LobehubSkillProvider {
  /** Provider icon URL */
  icon?: string;
  /** Provider ID (e.g., 'linear', 'github') */
  id: string;
  /** Display name */
  name: string;
  /** Whether token refresh is supported */
  refreshSupported?: boolean;
  /** Provider type */
  type?: 'mcp' | 'rest';
}

/**
 * LobeHub Skill Server instance (user-connected provider)
 */
export interface LobehubSkillServer {
  /** Cache timestamp */
  cachedAt?: number;
  /** Error message */
  errorMessage?: string;
  /** Provider icon URL */
  icon?: string;
  /** Provider ID (e.g., 'linear') */
  identifier: string;
  /** Whether authenticated */
  isConnected: boolean;
  /** Provider display name */
  name: string;
  /** Provider username (e.g., GitHub username) */
  providerUsername?: string;
  /** Authorized scopes */
  scopes?: string[];
  /** Connection status */
  status: LobehubSkillStatus;
  /** Token expiration time */
  tokenExpiresAt?: string;
  /** Tool list (available after connection) */
  tools?: LobehubSkillTool[];
}

/**
 * Parameters for calling LobeHub Skill tool
 */
export interface CallLobehubSkillToolParams {
  /** Tool arguments */
  args?: Record<string, unknown>;
  /** Provider ID (e.g., 'linear') */
  provider: string;
  /** Tool name */
  toolName: string;
}

/**
 * Result of calling LobeHub Skill tool
 */
export interface CallLobehubSkillToolResult {
  /** Return data */
  data?: any;
  /** Error message */
  error?: string;
  /** Error code */
  errorCode?: string;
  /** Whether successful */
  success: boolean;
}
