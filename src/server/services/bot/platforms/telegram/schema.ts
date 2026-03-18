import type { FieldSchema } from '../types';

export const schema: FieldSchema[] = [
  {
    key: 'credentials',
    label: 'Credentials',
    properties: [
      { key: 'botToken', label: 'Bot Token', required: true, type: 'password' },
      {
        key: 'secretToken',
        description: 'Optional secret token for webhook verification',
        label: 'Webhook Secret Token',
        required: false,
        type: 'password',
      },
      {
        devOnly: true,
        key: 'webhookProxyUrl',
        description: 'HTTPS proxy URL for local development (e.g. Cloudflare tunnel)',
        label: 'Webhook Proxy URL',
        required: false,
        type: 'string',
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
