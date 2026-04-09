import type { FieldSchema } from '../types';

const DEFAULT_CHAR_LIMIT = 4000;

export const schema: FieldSchema[] = [
  {
    key: 'applicationId',
    description: 'channel.dingtalk.appKeyHint',
    label: 'channel.applicationId',
    required: true,
    type: 'string',
  },
  {
    key: 'credentials',
    label: 'channel.credentials',
    properties: [
      {
        key: 'clientSecret',
        description: 'channel.appSecretHint',
        label: 'channel.appSecret',
        required: true,
        type: 'password',
      },
      {
        key: 'verificationToken',
        description: 'channel.dingtalk.verificationTokenHint',
        label: 'channel.verificationToken',
        required: true,
        type: 'password',
      },
      {
        key: 'aesKey',
        description: 'channel.dingtalk.aesKeyHint',
        label: 'channel.dingtalk.aesKey',
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
        key: 'messageType',
        default: 'markdown',
        description: 'channel.dingtalk.messageTypeHint',
        enum: ['markdown', 'text'],
        enumLabels: [
          'channel.dingtalk.messageTypeMarkdown',
          'channel.dingtalk.messageTypeText',
        ],
        label: 'channel.dingtalk.messageType',
        required: true,
        type: 'string',
      },
      {
        key: 'charLimit',
        default: DEFAULT_CHAR_LIMIT,
        description: 'channel.charLimitHint',
        label: 'channel.charLimit',
        maximum: 40_000,
        minimum: 100,
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
