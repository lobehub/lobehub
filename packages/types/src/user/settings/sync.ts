export interface WebRTCSyncConfig {
  channelName?: string;
  channelPassword?: string;
  enabled: boolean;
  signaling?: string;
}
export interface UserSyncSettings {
  deviceName?: string;
  webrtc: WebRTCSyncConfig;
}
