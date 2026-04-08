import { MAX_BOT_DEBOUNCE_MS } from '@lobechat/const';

import { displayToolCallsField, userIdField } from '../const';
import type { FieldSchema } from '../types';

export const schema: FieldSchema[] = [
  {
    key: 'applicationId',
    description: 'channel.applicationIdHint',
    label: 'channel.applicationId',
    required: true,
    type: 'string',
  },
  {
    key: 'credentials',
    label: 'channel.credentials',
    properties: [
      {
        key: 'appSecret',
        description: 'channel.appSecretHint',
        label: 'channel.appSecret',
        required: true,
        type: 'password',
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
        default: 2000,
        description: 'channel.charLimitHint',
        label: 'channel.charLimit',
        maximum: 2000,
        minimum: 100,
        type: 'number',
      },
      {
        key: 'concurrency',
        default: 'debounce',
        description: 'channel.concurrencyHint',
        enum: ['queue', 'debounce'],
        enumLabels: ['channel.concurrencyQueue', 'channel.concurrencyDebounce'],
        label: 'channel.concurrency',
        type: 'string',
      },
      {
        key: 'debounceMs',
        default: 5000,
        description: 'channel.debounceMsHint',
        label: 'channel.debounceMs',
        maximum: MAX_BOT_DEBOUNCE_MS,
        minimum: 100,
        type: 'number',
        visibleWhen: { field: 'concurrency', value: 'debounce' },
      },
      {
        key: 'showUsageStats',
        default: false,
        description: 'channel.showUsageStatsHint',
        label: 'channel.showUsageStats',
        type: 'boolean',
      },
      displayToolCallsField,
      userIdField,
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
