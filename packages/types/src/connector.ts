export type ConnectorLinkStatus = 'connected' | 'error';
export type ConnectorAuthKind = 'oauth2' | 'bearer' | 'apikey' | 'header' | 'none';

export interface ConnectorLinkProfile {
  avatar?: string;
  email?: string;
  name?: string;
  username?: string;
}
