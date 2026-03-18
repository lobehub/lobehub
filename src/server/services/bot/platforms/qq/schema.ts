import type { FieldSchema } from '../types';

export const schema: FieldSchema[] = [
  {
    key: 'credentials',
    label: 'channel.credentials',
    properties: [
      { key: 'appId', label: 'channel.appId', required: true, type: 'string' },
      { key: 'appSecret', label: 'channel.appSecret', required: true, type: 'password' },
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
        key: 'dm',
        label: 'channel.dm',
        properties: [
          { key: 'enabled', default: true, label: 'channel.dmEnabled', type: 'boolean' },
          {
            key: 'policy',
            default: 'open',
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
