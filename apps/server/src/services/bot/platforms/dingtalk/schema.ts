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
import {
  DEFAULT_DINGTALK_CONNECTION_MODE,
  DINGTALK_CHAR_LIMIT,
  DINGTALK_IDENTIFIER_PATTERN,
} from './const';

/**
 * DingTalk internal-app robot.
 *
 * - `applicationId` is the app's Client ID (formerly AppKey). It is both the
 *   Stream mode client id and the key of the `/api/agent/webhooks/dingtalk/…`
 *   route, so it is a plain identifier rather than a credential.
 * - `credentials.clientSecret` (formerly AppSecret) is the only secret: it
 *   mints the access token, opens Stream connections and signs callbacks.
 * - `credentials.robotCode` is optional. An internal-app robot's RobotCode is
 *   its Client ID, which the adapter uses when the field is blank; it is
 *   surfaced for robots whose code differs. No AgentId is needed: the robot
 *   send APIs (`oToMessages/batchSend`, `groupMessages/send`) address the
 *   robot by RobotCode, and AgentId only matters for work notifications.
 *
 * No `reactionMode` field: DingTalk robots have no reaction API, so the
 * setting would have nothing to drive (see `messageCapabilities.ts`).
 */
export const schema: FieldSchema[] = [
  {
    key: 'applicationId',
    description: 'channel.dingtalk.clientIdHint',
    label: 'channel.dingtalk.clientId',
    pattern: DINGTALK_IDENTIFIER_PATTERN,
    patternMessage: 'channel.dingtalk.identifierInvalid',
    placeholder: 'channel.dingtalk.clientIdPlaceholder',
    required: true,
    type: 'string',
  },
  {
    key: 'credentials',
    label: 'channel.credentials',
    properties: [
      {
        key: 'clientSecret',
        description: 'channel.dingtalk.clientSecretHint',
        label: 'channel.dingtalk.clientSecret',
        required: true,
        type: 'password',
      },
      {
        key: 'robotCode',
        description: 'channel.dingtalk.robotCodeHint',
        label: 'channel.dingtalk.robotCode',
        pattern: DINGTALK_IDENTIFIER_PATTERN,
        patternMessage: 'channel.dingtalk.identifierInvalid',
        type: 'string',
      },
    ],
    type: 'object',
  },
  {
    key: 'settings',
    label: 'channel.settings',
    properties: [
      makeUserIdField('dingtalk'),
      ...deviceAccessFields,
      {
        key: 'connectionMode',
        default: DEFAULT_DINGTALK_CONNECTION_MODE,
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
        default: DINGTALK_CHAR_LIMIT,
        description: 'channel.charLimitHint',
        label: 'channel.charLimit',
        maximum: DINGTALK_CHAR_LIMIT,
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
      // DingTalk only delivers group messages that @-mention the robot, so
      // `requireMention` is effectively always satisfied; the group policy and
      // allowlist still decide which groups the bot answers in.
      ...makeGroupPolicyFields({ policy: 'open' }),
      allowFromField,
      watchKeywordsField,
      ...replyStyleFields,
    ],
    type: 'object',
  },
];
