export interface DeviceItem {
  id: string;
  lastSeen?: string;
  name: string;
  os: string;
}

export const devicePrompt = (device: DeviceItem) => {
  const attrs = [`id="${device.id}"`, `name="${device.name}"`, `os="${device.os}"`];
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
