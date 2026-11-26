/** A single live gateway connection (channel) of a device. */
export interface DeviceChannel {
  channel?: string;
  connectedAt: string;
  connectionId: string;
}

/** Which principal pool a device belongs to. */
export type DeviceScope = 'personal' | 'workspace';

export interface DeviceAttachment {
  /** Live connections backing this device; absent for offline devices. */
  channels?: DeviceChannel[];
  deviceId: string;
  /**
   * User-set alias from the device-settings page. The gateway only knows the raw
   * `hostname`; this is merged in from the DB so the device shows the name the
   * user recognises. Null when never aliased.
   */
  friendlyName?: string | null;
  hostname: string;
  lastSeen: string;
  /**
   * A managed cloud device. It counts as always online for the model: when it
   * sleeps, activating it starts it, and its tool calls wait for it.
   */
  managed?: boolean;
  online: boolean;
  platform: string;
  /**
   * Whether this device is the caller's personal machine or a device enrolled
   * into the active workspace. Lets the model tell otherwise-identical devices
   * apart (the same physical machine can be connected under both principals) and
   * pick the workspace one when asked.
   */
  scope?: DeviceScope;
}

/**
 * The devices the model may pick: the live ones, plus managed cloud devices,
 * which are always online from the model's side. A sleeping cloud device is
 * reported online so the model activates it instead of telling the user to
 * connect a machine.
 */
export const toAvailableDevices = (devices: DeviceAttachment[]): DeviceAttachment[] =>
  devices
    .filter((device) => device.online || device.managed)
    .map((device) => (device.online ? device : { ...device, online: true }));
