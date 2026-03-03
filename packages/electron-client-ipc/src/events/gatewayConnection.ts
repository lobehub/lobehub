export type GatewayConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'reconnecting';

export interface GatewayConnectionBroadcastEvents {
  gatewayConnectionStatusChanged: (params: { status: GatewayConnectionStatus }) => void;
}
