export enum ComposioServerStatus {
  ACTIVE = 'active',
  ERROR = 'error',
  PENDING_AUTH = 'pending_auth',
}

export interface ComposioTool {
  description?: string;
  inputSchema: {
    properties?: Record<string, any>;
    required?: string[];
    type: string;
  };
  name: string;
}

export interface ComposioServer {
  /** Bind this connection to an agent (Agent-exclusive connection). */
  agentId?: string;
  appSlug: string;
  authConfigId: string;
  connectedAccountId: string;
  createdAt: number;
  errorMessage?: string;
  /** Whether the active Gmail account granted a scope that permits reading messages. */
  gmailReadPermission?: boolean;
  icon?: string;
  identifier: string;
  label: string;
  redirectUrl?: string;
  status: ComposioServerStatus;
  tools?: ComposioTool[];
}

export interface CreateComposioServerParams {
  /** Bind this connection to an agent (Agent-exclusive connection). */
  agentId?: string;
  appSlug: string;
  identifier: string;
  label: string;
}

export interface CallComposioToolParams {
  /** The agent the call runs for, from the invoking message. */
  agentId?: string;
  identifier: string;
  toolArgs?: Record<string, unknown>;
  toolSlug: string;
  /**
   * The conversation the call belongs to, from the invoking message. The server
   * resolves the connection in that conversation's scope (a private agent's own
   * topic may use its owner's private connection).
   */
  topicId?: string;
}

export interface CallComposioToolResult {
  data?: any;
  error?: string;
  success: boolean;
}
