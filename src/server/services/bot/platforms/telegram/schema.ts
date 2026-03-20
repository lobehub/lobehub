import { DEFAULT_DEBOUNCE_MS, MAX_DEBOUNCE_MS } from '../const';
import type { FieldSchema } from '../types';

export const schema: FieldSchema[] = [
  {
    key: 'credentials',
    label: 'channel.credentials',
    properties: [
      {
        key: 'botToken',
        description: 'channel.botTokenEncryptedHint',
        label: 'channel.botToken',
        required: true,
        type: 'password',
      },
      {
        key: 'secretToken',
        description: 'channel.secretTokenHint',
        label: 'channel.secretToken',
        required: false,
        type: 'password',
      },
      {
        devOnly: true,
        key: 'webhookProxyUrl',
        description: 'channel.devWebhookProxyUrlHint',
        label: 'channel.devWebhookProxyUrl',
        required: false,
        type: 'string',
      },
    ],
    type: 'object',
  },
  {
    key: 'settings',
    label: 'channel.settings',
    properties: [
      {
        key: 'charLimit',
        default: 4000,
        description: 'channel.charLimitHint',
        label: 'channel.charLimit',
        maximum: 4096,
        minimum: 100,
        type: 'number',
      },
      {
        key: 'debounceMs',
        default: DEFAULT_DEBOUNCE_MS,
        description: 'channel.debounceMsHint',
        label: 'channel.debounceMs',
        maximum: MAX_DEBOUNCE_MS,
        minimum: 0,
        type: 'number',
      },
      {
        key: 'showUsageStats',
        default: false,
        description: 'channel.showUsageStatsHint',
        label: 'channel.showUsageStats',
        type: 'boolean',
      },
      // TODO: DM schema - not implemented yet
      // {
      //   key: 'dm',
      //   label: 'channel.dm',
      //   properties: [
      //     {
      //       key: 'enabled',
      //       default: true,
      //       description: 'channel.dmEnabledHint',
      //       label: 'channel.dmEnabled',
      //       type: 'boolean',
      //     },
      //     {
      //       key: 'policy',
      //       default: 'open',
      //       enum: ['open', 'allowlist', 'disabled'],
      //       enumLabels: [
      //         'channel.dmPolicyOpen',
      //         'channel.dmPolicyAllowlist',
      //         'channel.dmPolicyDisabled',
      //       ],
      //       description: 'channel.dmPolicyHint',
      //       label: 'channel.dmPolicy',
      //       type: 'string',
      //       visibleWhen: { field: 'enabled', value: true },
      //     },
      //   ],
      //   type: 'object',
      // },
    ],
    type: 'object',
  },
];
