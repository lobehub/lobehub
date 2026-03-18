import type { FieldSchema } from '../../types';
import { FeishuClientFactory } from '../client';

export const sharedCredentials: FieldSchema[] = [
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
];

export const sharedSettings: FieldSchema[] = [
  {
    key: 'charLimit',
    default: 4000,
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

export const sharedClientFactory = new FeishuClientFactory();
