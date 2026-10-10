export type GatewayConnectionStatus =
  'connected' | 'connecting' | 'disconnected' | 'reconnecting' | 'authenticating';

/**
 * Why the last connection attempt ended. Cleared when a new attempt starts or
 * the user turns the connection off.
 */
export type GatewayConnectionErrorCode =
  /** The gateway rejected this login's credential. */
  | 'auth_failed'
  /** The current server's configuration could not be loaded. */
  | 'config_unavailable'
  /** The saved, advertised or overridden gateway address is not a usable URL. */
  | 'invalid_gateway_url'
  | 'not_signed_in';

export interface GatewayConnectionError {
  code: GatewayConnectionErrorCode;
  /** Diagnostic detail for logs and tooltips; user-facing copy comes from `code`. */
  detail?: string;
}

export interface GatewayConnectionState {
  error?: GatewayConnectionError;
  status: GatewayConnectionStatus;
}

export interface GatewayConnectResult {
  error?: string;
  errorCode?: GatewayConnectionErrorCode;
  success: boolean;
}

export type GatewayEndpointSource = 'manual' | 'official' | 'override' | 'server';

export interface GatewayEndpointInfo {
  /** Address of the current connection, once one has been resolved. */
  endpoint?: { source: GatewayEndpointSource; url: string };
  /** Address saved in settings; it beats the server's own. */
  manualUrl?: string;
  /** The server the desktop is signed in to, when there is one. */
  serverUrl?: string;
}

export interface SetGatewayManualUrlResult {
  error?: 'invalid_url';
  /** What is saved now; absent when cleared (saving the official gateway clears it). */
  savedUrl?: string;
  success: boolean;
}

export interface GatewayConnectionBroadcastEvents {
  gatewayConnectionStatusChanged: (params: GatewayConnectionState) => void;
}
