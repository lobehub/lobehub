import type { FieldSchema, PlatformDefinition } from '../types';
import { DiscordClientFactory } from './client';

const settings: FieldSchema[] = [
  {
    key: 'connectionMode',
    default: 'websocket',
    description: 'How the bot connects to Discord',
    enum: ['websocket', 'webhook'],
    enumLabels: ['WebSocket (Gateway)', 'Webhook'],
    group: 'connection',
    label: 'Connection Mode',
    type: 'string',
  },
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
    key: 'showUsageStats',
    default: false,
    description: 'Show token usage, cost, and duration stats in bot replies',
    group: 'general',
    label: 'Show Usage Stats',
    type: 'boolean',
  },
  {
    key: 'dm',
    group: 'dm',
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
];

export const discord: PlatformDefinition = {
  id: 'discord',
  name: 'Discord',
  description: 'Connect a Discord bot',
  documentation: {
    portalUrl: 'https://discord.com/developers/applications',
    setupGuideUrl: 'https://lobehub.com/docs/usage/channels/discord',
  },
  credentials: [
    { key: 'botToken', label: 'Bot Token', required: true, type: 'password' },
    { key: 'publicKey', label: 'Public Key', required: true, type: 'string' },
    { key: 'applicationId', label: 'Application ID', required: true, type: 'string' },
  ],
  settings,

  clientFactory: new DiscordClientFactory(),
};
