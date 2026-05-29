/** A single live gateway connection (channel) of a device. */
export interface DeviceChannel {
  channel?: string;
  connectedAt: string;
  connectionId: string;
}

export interface DeviceAttachment {
  /** Live connections backing this device; absent for offline devices. */
  channels?: DeviceChannel[];
  deviceId: string;
  hostname: string;
  lastSeen: string;
  online: boolean;
  platform: string;
}
