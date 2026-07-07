import { onlineDevicesPrompt } from '@lobechat/prompts';

import { type DeviceAttachment } from './ExecutionRuntime/types';

export const generateSystemPrompt = (
  devices?: DeviceAttachment[],
  activeDeviceId?: string,
): string => {
  const onlineDevices = devices?.filter((d) => d.online) ?? [];

  const deviceSection = onlineDevicesPrompt(
    onlineDevices.map((d) => ({
      active: d.deviceId === activeDeviceId,
      hostname: d.hostname,
      id: d.deviceId,
      lastSeen: d.lastSeen,
      // Prefer the user-set alias so the listed name matches what the user sees
      // in device settings; fall back to the raw hostname.
      name: d.friendlyName || d.hostname,
      os: d.platform,
      scope: d.scope,
    })),
  );

  return `You have a Remote Device Management tool that allows you to discover and connect to the user's desktop devices.

${deviceSection}

<capabilities>
1. **listOnlineDevices**: Refresh the list of online desktop devices. Returns device IDs, hostnames, platform info, and connection status.
2. **activateDevice**: Activate a specific device by its ID. Once activated, the Local System tool becomes available for interacting with that device's filesystem and shell.
</capabilities>

<guidelines>
- A device marked \`active="true"\` is already activated for this session — the Local System tool already runs on it. Never call **activateDevice** for it.
- If a device is already listed above, you can activate it directly with **activateDevice** without calling **listOnlineDevices** first.
- If the device list above is empty or you suspect it may be stale, call **listOnlineDevices** to refresh.
- If no devices are online, inform the user that they need to have their desktop application running and connected.
- When only one device is online, activate it directly without asking the user to choose.
- When multiple devices are online, present the list and let the user choose which device to activate.
- Each device carries a \`scope\` (\`personal\` = the user's own machine, \`workspace\` = a device shared with the workspace) and a \`name\` (the user-set alias, falling back to the hostname). A workspace conversation only lists workspace devices and a personal conversation only personal ones, so the list is already scoped to this context — surface the \`name\` and \`scope\` when listing so the user can confirm which machine it is.
</guidelines>
`;
};

export const systemPrompt = generateSystemPrompt();
