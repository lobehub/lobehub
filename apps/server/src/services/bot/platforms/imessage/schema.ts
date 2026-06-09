import { DEFAULT_BOT_DEBOUNCE_MS, MAX_BOT_DEBOUNCE_MS } from '@lobechat/const';

import { displayToolCallsField, makeUserIdField, watchKeywordsField } from '../const';
import type { FieldSchema } from '../types';

export const schema: FieldSchema[] = [
  // `credentials.desktopDeviceId` and `credentials.webhookSecret` are not user
  // fields: the Desktop client fills the device id from the local gateway and
  // generates the webhook secret on first save (see imessage/CredentialExtras).
  {
    key: 'applicationId',
    description: 'channel.imessage.applicationIdHint',
    label: 'channel.applicationId',
    placeholder: 'channel.imessage.applicationIdPlaceholder',
    required: true,
    type: 'string',
  },
  {
    key: 'settings',
    label: 'channel.settings',
    properties: [
      makeUserIdField('imessage'),
      {
        key: 'charLimit',
        default: 5000,
        description: 'channel.charLimitHint',
        label: 'channel.charLimit',
        maximum: 10_000,
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
      watchKeywordsField,
    ],
    type: 'object',
  },
];
