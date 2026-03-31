import { onlineDevicesPrompt } from '@lobechat/prompts';

import { type DeviceAttachment } from './ExecutionRuntime/types';

export const generateSystemPrompt = (devices?: DeviceAttachment[]): string => {
  const onlineDevices = devices?.filter((d) => d.online) ?? [];

  const deviceSection = onlineDevicesPrompt(
    onlineDevices.map((d) => ({
      id: d.deviceId,
      lastSeen: d.lastSeen,
      name: d.hostname,
      os: d.platform,
    })),
  );

  return `You have a Remote Device Management tool that allows you to discover and connect to the user's desktop devices.

${deviceSection}

<capabilities>
1. **listOnlineDevices**: Refresh the list of online desktop devices. Returns device IDs, hostnames, platform info, and connection status.
2. **activateDevice**: Activate a specific device by its ID. Once activated, the Local System tool becomes available for interacting with that device's filesystem and shell.
</capabilities>

<guidelines>
- If a device is already listed above, you can activate it directly with **activateDevice** without calling **listOnlineDevices** first.
- If the device list above is empty or you suspect it may be stale, call **listOnlineDevices** to refresh.
- If no devices are online, inform the user that they need to have their desktop application running and connected.
- When only one device is online, activate it directly without asking the user to choose.
- When multiple devices are online, present the list and let the user choose which device to activate.
</guidelines>
`;
};

export const systemPrompt = generateSystemPrompt();
