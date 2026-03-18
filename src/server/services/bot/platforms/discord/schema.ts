import type { FieldSchema } from '../types';

export const schema: FieldSchema[] = [
  {
    key: 'credentials',
    label: 'channel.credentials',
    properties: [
      { key: 'applicationId', label: 'channel.applicationId', required: true, type: 'string' },
      { key: 'publicKey', label: 'channel.publicKey', required: true, type: 'string' },
      { key: 'botToken', label: 'channel.botToken', required: true, type: 'password' },
    ],
    type: 'object',
  },
  {
    key: 'settings',
    label: 'channel.settings',
    properties: [
      {
        key: 'charLimit',
        default: 2000,
        label: 'channel.charLimit',
        minimum: 100,
        type: 'number',
      },
      {
        key: 'debounceMs',
        default: 2000,
        description: 'channel.debounceMsDesc',
        label: 'channel.debounceMs',
        minimum: 0,
        type: 'number',
      },
      {
        key: 'showUsageStats',
        default: false,
        description: 'channel.showUsageStatsDesc',
        label: 'channel.showUsageStats',
        type: 'boolean',
      },
      {
        key: 'dm',
        label: 'channel.dm',
        properties: [
          { key: 'enabled', default: false, label: 'channel.dmEnabled', type: 'boolean' },
          {
            key: 'policy',
            default: 'disabled',
            enum: ['open', 'allowlist', 'disabled'],
            enumLabels: [
              'channel.dmPolicyOpen',
              'channel.dmPolicyAllowlist',
              'channel.dmPolicyDisabled',
            ],
            label: 'channel.dmPolicy',
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
