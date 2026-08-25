export interface RendererOtaUpdateInfo {
  appVersion: string;
  version: string;
}

export interface RendererOtaBroadcastEvents {
  rendererUpdateReady: (info: RendererOtaUpdateInfo) => void;
}
