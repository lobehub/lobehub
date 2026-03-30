import { DEFAULT_BOT_HISTORY_LIMIT } from '@lobechat/const';

import type { FieldSchema } from './types';

export const historyLimitField: FieldSchema = {
  key: 'historyLimit',
  default: DEFAULT_BOT_HISTORY_LIMIT,
  description: 'channel.historyLimitHint',
  label: 'channel.historyLimit',
  maximum: 100,
  minimum: 1,
  type: 'number',
};

export const serverIdField: FieldSchema = {
  key: 'serverId',
  description: 'channel.serverIdHint',
  label: 'channel.serverId',
  type: 'string',
};

export const userIdField: FieldSchema = {
  key: 'userId',
  description: 'channel.userIdHint',
  label: 'channel.userId',
  type: 'string',
};
