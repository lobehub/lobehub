import { DEFAULT_BOT_DEBOUNCE_MS, MAX_BOT_DEBOUNCE_MS } from '@lobechat/const';

import { displayToolCallsField, makeUserIdField } from '../const';
import type { FieldSchema } from '../types';

export const schema: FieldSchema[] = [
  {
    key: 'applicationId',
    description: 'channel.line.destinationUserIdHint',
    label: 'channel.line.destinationUserId',
    placeholder: 'channel.line.destinationUserIdPlaceholder',
    required: true,
    type: 'string',
  },
  {
    key: 'credentials',
    label: 'channel.credentials',
    properties: [
      {
        key: 'channelAccessToken',
        description: 'channel.line.channelAccessTokenHint',
        label: 'channel.line.channelAccessToken',
        required: true,
        type: 'password',
      },
      {
        key: 'channelSecret',
        description: 'channel.line.channelSecretHint',
        label: 'channel.line.channelSecret',
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
        default: 5000,
        description: 'channel.charLimitHint',
        label: 'channel.charLimit',
        // LINE Messaging API enforces a 5,000-character cap per text message.
        maximum: 5000,
        minimum: 100,
        type: 'number',
      },
      {
        key: 'concurrency',
        default: 'queue',
        description: 'channel.concurrencyHint',
        enum: ['queue', 'debounce'],
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
      makeUserIdField('line'),
    ],
    type: 'object',
  },
];
