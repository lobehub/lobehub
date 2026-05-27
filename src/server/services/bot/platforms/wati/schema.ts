import { DEFAULT_BOT_DEBOUNCE_MS, MAX_BOT_DEBOUNCE_MS } from '@lobechat/const';

import { displayToolCallsField, makeUserIdField } from '../const';
import type { FieldSchema } from '../types';

export const schema: FieldSchema[] = [
  {
    key: 'credentials',
    label: 'channel.credentials',
    properties: [
      {
        key: 'apiBaseUrl',
        default: 'https://live-mt-server.wati.io',
        description: 'channel.wati.apiBaseUrlHint',
        label: 'channel.wati.apiBaseUrl',
        placeholder: 'https://live-mt-server.wati.io',
        required: true,
        type: 'string',
      },
      {
        key: 'tenantId',
        description: 'channel.wati.tenantIdHint',
        label: 'channel.wati.tenantId',
        required: true,
        type: 'string',
      },
      {
        key: 'bearerToken',
        description: 'channel.wati.bearerTokenHint',
        label: 'channel.wati.bearerToken',
        required: true,
        type: 'password',
      },
      {
        key: 'webhookSecret',
        description: 'channel.wati.webhookSecretHint',
        label: 'channel.wati.webhookSecret',
        type: 'password',
      },
      {
        devOnly: true,
        key: 'webhookProxyUrl',
        description: 'channel.devWebhookProxyUrlHint',
        label: 'channel.devWebhookProxyUrl',
        type: 'string',
      },
    ],
    type: 'object',
  },
  {
    key: 'applicationId',
    description: 'channel.wati.channelPhoneNumberHint',
    label: 'channel.wati.channelPhoneNumber',
    placeholder: 'channel.wati.channelPhoneNumberPlaceholder',
    required: true,
    type: 'string',
  },
  {
    key: 'settings',
    label: 'channel.settings',
    properties: [
      makeUserIdField('wati'),
      {
        key: 'charLimit',
        default: 4096,
        description: 'channel.charLimitHint',
        label: 'channel.charLimit',
        maximum: 4096,
        minimum: 100,
        type: 'number',
      },
      {
        key: 'concurrency',
        default: 'queue',
        description: 'channel.concurrencyHint',
        enum: ['queue', 'debounce'],
        enumDescriptions: ['channel.concurrencyQueueHint', 'channel.concurrencyDebounceHint'],
        enumLabels: ['channel.concurrencyQueue', 'channel.concurrencyDebounce'],
        label: 'channel.concurrency',
        type: 'string',
      },
      {
        key: 'debounceMs',
        default: DEFAULT_BOT_DEBOUNCE_MS,
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
    ],
    type: 'object',
  },
];
