import type { FieldSchema } from './types';

export const displayToolCallsField: FieldSchema = {
  key: 'displayToolCalls',
  default: true,
  description: 'channel.displayToolCallsHint',
  label: 'channel.displayToolCalls',
  type: 'boolean',
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
