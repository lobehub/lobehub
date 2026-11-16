export interface ConnectorOAuthRequest {
  authorizationUrl: string;
  connectorId: string;
  freshSession?: boolean;
  requestId?: string;
}

export type ConnectorOAuthResult = 'success' | 'dismissed' | 'failed' | 'timeout';

export interface ConnectorOAuthIpc {
  authorize: (params: ConnectorOAuthRequest) => Promise<ConnectorOAuthResult>;
  cancel: (params: { requestId: string }) => Promise<void>;
}
