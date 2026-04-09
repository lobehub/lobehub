import {
  DEFAULT_BOT_DEBOUNCE_MS,
  DEFAULT_BOT_HISTORY_LIMIT,
  MAX_BOT_DEBOUNCE_MS,
  MIN_BOT_HISTORY_LIMIT,
} from '@lobechat/const';

import { displayToolCallsField, serverIdField, userIdField } from '../const';
import type { FieldSchema } from '../types';
import { DEFAULT_SLACK_CONNECTION_MODE, MAX_SLACK_HISTORY_LIMIT } from './const';

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
        key: 'botToken',
        description: 'channel.botTokenEncryptedHint',
        label: 'channel.botToken',
        required: true,
        type: 'password',
      },
      {
        key: 'signingSecret',
        description: 'channel.signingSecretHint',
        label: 'channel.signingSecret',
        required: true,
        type: 'password',
      },
      {
        key: 'appToken',
        description: 'channel.slack.appTokenHint',
        label: 'channel.slack.appToken',
        placeholder: 'xapp-...',
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
        key: 'connectionMode',
        default: DEFAULT_SLACK_CONNECTION_MODE,
        description: 'channel.connectionModeHint',
        enum: ['websocket', 'webhook'],
        enumLabels: ['channel.connectionModeWebSocket', 'channel.connectionModeWebhook'],
        label: 'channel.connectionMode',
        type: 'string',
      },
      {
        key: 'charLimit',
        default: 4000,
        description: 'channel.charLimitHint',
        label: 'channel.charLimit',
        maximum: 40_000,
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
      {
        key: 'historyLimit',
        default: DEFAULT_BOT_HISTORY_LIMIT,
        description: 'channel.historyLimitHint',
        label: 'channel.historyLimit',
        maximum: MAX_SLACK_HISTORY_LIMIT,
        minimum: MIN_BOT_HISTORY_LIMIT,
        type: 'number',
      },
      serverIdField,
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
