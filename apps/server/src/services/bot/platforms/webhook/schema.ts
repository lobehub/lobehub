import { DEFAULT_BOT_DEBOUNCE_MS, MAX_BOT_DEBOUNCE_MS } from '@lobechat/const';

import {
  allowFromField,
  displayToolCallsField,
  makeDmPolicyField,
  makeGroupPolicyFields,
  makeUserIdField,
  watchKeywordsField,
} from '../const';
import type { FieldSchema } from '../types';
import { BOT_ID_PATTERN, MIN_SIGNING_SECRET_LENGTH } from './protocol';

export const schema: FieldSchema[] = [
  {
    key: 'applicationId',
    description: 'channel.webhook.botIdHint',
    label: 'channel.webhook.botId',
    pattern: BOT_ID_PATTERN,
    patternMessage: 'channel.webhook.botIdInvalid',
    placeholder: 'channel.webhook.botIdPlaceholder',
    required: true,
    type: 'string',
  },
  {
    key: 'credentials',
    label: 'channel.credentials',
    properties: [
      {
        key: 'callbackUrl',
        description: 'channel.webhook.callbackUrlHint',
        label: 'channel.webhook.callbackUrl',
        pattern: '^https?://\\S+$',
        patternMessage: 'channel.webhook.callbackUrlInvalid',
        placeholder: 'https://example.com/lobehub/callback',
        required: true,
        type: 'string',
      },
      {
        key: 'signingSecret',
        description: 'channel.webhook.signingSecretHint',
        label: 'channel.webhook.signingSecret',
        pattern: `^\\S{${MIN_SIGNING_SECRET_LENGTH},}$`,
        patternMessage: 'channel.webhook.signingSecretInvalid',
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
      makeUserIdField(),
      {
        key: 'charLimit',
        default: 20_000,
        description: 'channel.charLimitHint',
        label: 'channel.charLimit',
        maximum: 32_000,
        minimum: 100,
        type: 'number',
      },
      {
        key: 'concurrency',
        default: 'queue',
        description: 'channel.concurrencyHint',
        enum: ['queue', 'burst', 'debounce'],
        enumDescriptions: [
          'channel.concurrencyQueueHint',
          'channel.concurrencyBurstHint',
          'channel.concurrencyDebounceHint',
        ],
        enumLabels: [
          'channel.concurrencyQueue',
          'channel.concurrencyBurst',
          'channel.concurrencyDebounce',
        ],
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
      makeDmPolicyField({ policy: 'open' }),
      ...makeGroupPolicyFields({ policy: 'open' }),
      allowFromField,
      watchKeywordsField,
    ],
    type: 'object',
  },
];
