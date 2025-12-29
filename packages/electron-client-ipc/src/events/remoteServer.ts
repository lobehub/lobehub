export interface MarketAuthorizationParams {
  authUrl: string;
}

/**
 * 从主进程广播的远程服务器相关事件
 */
export interface RemoteServerBroadcastEvents {
  authorizationFailed: (params: { error: string }) => void;
  authorizationRequired: (params: void) => void;
  authorizationSuccessful: (params: void) => void;
  remoteServerConfigUpdated: (params: void) => void;
  tokenRefreshed: (params: void) => void;
}
