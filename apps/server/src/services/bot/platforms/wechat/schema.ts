import { DEFAULT_BOT_DEBOUNCE_MS, MAX_BOT_DEBOUNCE_MS } from '@lobechat/const';

import { displayToolCallsField, watchKeywordsField } from '../const';
import type { FieldSchema } from '../types';

export const schema: FieldSchema[] = [
  // No credentials fields — credentials are populated automatically after QR scan.
  {
    key: 'settings',
    label: 'channel.settings',
    properties: [
      {
        key: 'charLimit',
        default: 2000,
        description: 'channel.charLimitHint',
        label: 'channel.charLimit',
        maximum: 2048,
        minimum: 100,
        type: 'number',
      },
      {
        key: 'concurrency',
        // WeChat splits one logical turn across several messages: an image and
        // the sentence about it arrive as two webhooks a few hundred ms apart.
        // `burst` collects that window and hands the agent a single turn, so the
        // picture and its instruction are never answered separately.
        default: 'burst',
        description: 'channel.concurrencyHint',
        // No `queue` here: WeChat splits a turn across messages, so dispatching
        // the first one immediately answers the picture before its sentence
        // arrives. Channels stored before `burst` existed still carry `queue`;
        // `resolveBotConcurrency` maps that to `burst` at runtime.
        enum: ['burst', 'debounce'],
        enumDescriptions: ['channel.concurrencyBurstHint', 'channel.concurrencyDebounceHint'],
        enumLabels: ['channel.concurrencyBurst', 'channel.concurrencyDebounce'],
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
        visibleWhen: { field: 'concurrency', value: ['burst', 'debounce'] },
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
