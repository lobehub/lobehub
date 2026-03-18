import type { FieldSchema } from '../../types';

export const sharedSchema: FieldSchema[] = [
  {
    key: 'credentials',
    label: 'Credentials',
    properties: [
      { key: 'appId', label: 'App ID', required: true, type: 'string' },
      { key: 'appSecret', label: 'App Secret', required: true, type: 'password' },
      {
        key: 'encryptKey',
        description: 'AES decrypt key for encrypted events (optional)',
        label: 'Encrypt Key',
        required: false,
        type: 'password',
      },
      {
        key: 'verificationToken',
        description: 'Token for webhook event validation (optional)',
        label: 'Verification Token',
        required: false,
        type: 'password',
      },
    ],
    type: 'object',
  },
  {
    key: 'settings',
    label: 'Settings',
    properties: [
      {
        key: 'charLimit',
        default: 4000,
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
        key: 'dm',
        label: 'Direct Messages',
        properties: [
          { key: 'enabled', default: true, label: 'Enable DMs', type: 'boolean' },
          {
            key: 'policy',
            default: 'open',
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
