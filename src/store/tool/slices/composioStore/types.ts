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
  identifier: string;
  toolArgs?: Record<string, unknown>;
  toolSlug: string;
}

export interface CallComposioToolResult {
  data?: any;
  error?: string;
  success: boolean;
}
