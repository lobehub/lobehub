import {
  DEFAULT_BOT_DEBOUNCE_MS,
  DEFAULT_BOT_HISTORY_LIMIT,
  MAX_BOT_DEBOUNCE_MS,
  MIN_BOT_HISTORY_LIMIT,
} from '@lobechat/const';

import {
  allowFromField,
  displayToolCallsField,
  makeDmPolicyField,
  makeGroupPolicyFields,
  makeUserIdField,
} from '../../const';
import type { FieldSchema } from '../../types';
import { DEFAULT_FEISHU_CONNECTION_MODE, MAX_FEISHU_HISTORY_LIMIT } from '../const';

export const sharedSchema: FieldSchema[] = [
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
      {
        key: 'verificationToken',
        description: 'channel.verificationTokenHint',
        label: 'channel.verificationToken',
        required: false,
        type: 'password',
      },
      {
        key: 'encryptKey',
        description: 'channel.encryptKeyHint',
        label: 'channel.encryptKey',
        required: false,
        type: 'password',
      },
    ],
    type: 'object',
  },
  {
    key: 'settings',
    label: 'channel.settings',
    properties: [
      makeUserIdField('feishu'),
      {
        key: 'connectionMode',
        default: DEFAULT_FEISHU_CONNECTION_MODE,
        description: 'channel.connectionModeHint',
        enum: ['websocket', 'webhook'],
        enumDescriptions: [
          'channel.connectionModeWebSocketHint',
          'channel.connectionModeWebhookHint',
        ],
        enumLabels: ['channel.connectionModeWebSocket', 'channel.connectionModeWebhook'],
        label: 'channel.connectionMode',
        type: 'string',
      },
      {
        key: 'charLimit',
        default: 4000,
        description: 'channel.charLimitHint',
        label: 'channel.charLimit',
        maximum: 30_000,
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
      {
        key: 'historyLimit',
        default: DEFAULT_BOT_HISTORY_LIMIT,
        description: 'channel.historyLimitHint',
        label: 'channel.historyLimit',
        maximum: MAX_FEISHU_HISTORY_LIMIT,
        minimum: MIN_BOT_HISTORY_LIMIT,
        type: 'number',
      },
      makeDmPolicyField({ policy: 'open' }),
      ...makeGroupPolicyFields({ policy: 'open' }),
      allowFromField,
    ],
    type: 'object',
  },
];
