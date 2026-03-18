import type { FieldSchema, PlatformDefinition } from '../types';
import { QQClientFactory } from './client';

const settings: FieldSchema[] = [
  {
    key: 'charLimit',
    default: 2000,
    group: 'general',
    label: 'Character Limit',
    minimum: 100,
    type: 'number',
  },
  {
    key: 'debounceMs',
    default: 2000,
    description: 'How long to wait for additional messages before dispatching to the agent (ms)',
    group: 'general',
    label: 'Message Merge Window (ms)',
    minimum: 0,
    type: 'number',
  },
  {
    key: 'dm',
    group: 'dm',
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
];

export const qq: PlatformDefinition = {
  id: 'qq',
  name: 'QQ',
  description: 'Connect a QQ bot',
  documentation: {
    portalUrl: 'https://q.qq.com/',
    setupGuideUrl: 'https://lobehub.com/docs/usage/channels/qq',
  },
  credentials: [
    { key: 'appId', label: 'App ID', required: true, type: 'string' },
    { key: 'appSecret', label: 'App Secret', required: true, type: 'password' },
  ],
  settings,

  clientFactory: new QQClientFactory(),
};
