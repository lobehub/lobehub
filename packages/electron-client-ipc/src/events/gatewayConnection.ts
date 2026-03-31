export type GatewayConnectionStatus =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'reconnecting'
  | 'authenticating';

export interface GatewayConnectionBroadcastEvents {
  gatewayConnectionStatusChanged: (params: { status: GatewayConnectionStatus }) => void;
}
