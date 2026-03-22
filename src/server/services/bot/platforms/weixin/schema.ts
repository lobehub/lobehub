import { DEFAULT_DEBOUNCE_MS, MAX_DEBOUNCE_MS } from '../const';
import type { FieldSchema } from '../types';

export const schema: FieldSchema[] = [
  {
    key: 'credentials',
    label: 'channel.credentials',
    properties: [
      {
        key: 'appToken',
        description: 'channel.weixinAppTokenHint',
        label: 'channel.weixinAppToken',
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
        default: 2048,
        description: 'channel.charLimitHint',
        label: 'channel.charLimit',
        maximum: 2048,
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
    ],
    type: 'object',
  },
];
