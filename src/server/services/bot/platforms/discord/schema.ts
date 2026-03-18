import type { FieldSchema } from '../types';

export const schema: FieldSchema[] = [
  {
    key: 'credentials',
    label: 'Credentials',
    properties: [
      { key: 'applicationId', label: 'Application ID', required: true, type: 'string' },
      { key: 'publicKey', label: 'Public Key', required: true, type: 'string' },
      { key: 'botToken', label: 'Bot Token', required: true, type: 'password' },
    ],
    type: 'object',
  },
  {
    key: 'settings',
    label: 'Settings',
    properties: [
      {
        key: 'charLimit',
        default: 2000,
        label: 'Character Limit',
        minimum: 100,
        type: 'number',
      },
      {
        key: 'debounceMs',
        default: 2000,
        description:
          'How long to wait for additional messages before dispatching to the agent (ms)',
        label: 'Message Merge Window (ms)',
        minimum: 0,
        type: 'number',
      },
      {
        key: 'showUsageStats',
        default: false,
        description: 'Show token usage, cost, and duration stats in bot replies',
        label: 'Show Usage Stats',
        type: 'boolean',
      },
      {
        key: 'dm',
        label: 'Direct Messages',
        properties: [
          { key: 'enabled', default: false, label: 'Enable DMs', type: 'boolean' },
          {
            key: 'policy',
            default: 'disabled',
            enum: ['open', 'allowlist', 'disabled'],
            enumLabels: ['Open', 'Allowlist', 'Disabled'],
            label: 'DM Policy',
            type: 'string',
            visibleWhen: { field: 'enabled', value: true },
          },
        ],
        type: 'object',
      },
    ],
    type: 'object',
  },
];
