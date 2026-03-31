import { type BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { RemoteDeviceApiName, RemoteDeviceIdentifier } from './types';

export const RemoteDeviceManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'List all online desktop devices belonging to the current user. Returns device IDs, hostnames, platform, and connection status.',
      name: RemoteDeviceApiName.listOnlineDevices,
      parameters: {
        properties: {},
        type: 'object',
      },
    },
    {
      description:
        'Activate a specific desktop device by its ID. Once activated, the Local System tool becomes available for file operations and shell commands on that device.',
      name: RemoteDeviceApiName.activateDevice,
      parameters: {
        properties: {
          deviceId: {
            description: 'The unique identifier of the device to activate',
            type: 'string',
          },
        },
        required: ['deviceId'],
        type: 'object',
      },
    },
  ],
  humanIntervention: 'never',
  identifier: RemoteDeviceIdentifier,
  meta: {
    avatar: '🖥️',
    description: 'Discover and manage remote desktop device connections',
    readme:
      'Manage connections to your desktop devices. List online devices, activate a device for remote operations, and check connection status.',
    title: 'Remote Device',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
