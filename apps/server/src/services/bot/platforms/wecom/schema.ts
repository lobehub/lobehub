import { MAX_BOT_DEBOUNCE_MS } from '@lobechat/const';

import {
  allowFromField,
  displayToolCallsField,
  makeDmPolicyField,
  makeGroupPolicyFields,
  makeUserIdField,
  processingMessageField,
  watchKeywordsField,
} from '../const';
import { deviceAccessFields } from '../deviceAccess';
import { replyStyleFields } from '../replyStyle';
import type { FieldSchema } from '../types';

/**
 * Stream content is capped at 20480 UTF-8 bytes; 6000 characters stays under it even when every
 * character is a 3-byte CJK one.
 */
export const WECOM_MAX_CHAR_LIMIT = 6000;

export const schema: FieldSchema[] = [
  {
    key: 'applicationId',
    description: 'channel.wecom.botIdHint',
    label: 'channel.wecom.botId',
    required: true,
    type: 'string',
  },
  {
    key: 'credentials',
    label: 'channel.credentials',
    properties: [
      {
        key: 'secret',
        description: 'channel.wecom.secretHint',
        label: 'channel.wecom.secret',
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
      makeUserIdField('wecom'),
      ...deviceAccessFields,
      {
        key: 'charLimit',
        default: WECOM_MAX_CHAR_LIMIT,
        description: 'channel.charLimitHint',
        label: 'channel.charLimit',
        maximum: WECOM_MAX_CHAR_LIMIT,
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
        default: 5000,
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
      processingMessageField,
      makeDmPolicyField({ policy: 'open' }),
      ...makeGroupPolicyFields({ policy: 'open' }),
      allowFromField,
      watchKeywordsField,
      ...replyStyleFields,
    ],
    type: 'object',
  },
];
