export interface DeviceItem {
  /** Raw machine hostname; rendered alongside `name` when an alias differs. */
  hostname?: string;
  id: string;
  lastSeen?: string;
  /** Display name — the user-set alias when present, else the hostname. */
  name: string;
  os: string;
  /** 'personal' = the user's own machine, 'workspace' = enrolled into the workspace. */
  scope?: string;
}

export const devicePrompt = (device: DeviceItem) => {
  const attrs = [`id="${device.id}"`, `name="${device.name}"`];
  // Surface the raw hostname too, but only when it adds information beyond `name`.
  if (device.hostname && device.hostname !== device.name) {
    attrs.push(`hostname="${device.hostname}"`);
  }
  attrs.push(`os="${device.os}"`);
  if (device.scope) attrs.push(`scope="${device.scope}"`);
  if (device.lastSeen) attrs.push(`last-seen="${device.lastSeen}"`);
  return `  <device ${attrs.join(' ')} />`;
};

export const onlineDevicesPrompt = (devices: DeviceItem[]) => {
  if (devices.length === 0) {
    return `<online-devices>
  No devices are currently online.
</online-devices>`;
  }

  const deviceTags = devices.map((d) => devicePrompt(d)).join('\n');

  return `<online-devices>
${deviceTags}
</online-devices>`;
};
