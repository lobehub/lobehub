import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { ChannelApiName, ChannelIdentifier } from './types';

export const ChannelManifest: BuiltinToolManifest = {
  identifier: ChannelIdentifier,
  type: 'builtin',
  systemRole: systemPrompt,
  meta: {
    avatar: '#',
    title: 'Channel history',
    description: 'Read the current shared conversation when you need context.',
  },
  api: [
    {
      name: ChannelApiName.readMessages,
      description:
        'Read recent public messages in the current Channel or thread, in chronological order. Includes the parent channel prefix up to the thread root. Default 10, maximum 20 messages, with 2000-character excerpts. Use nextBeforeSequence to page backwards; readMessage retrieves full text and attachments. Scope and request cutoff are fixed by the runtime.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          beforeSequence: {
            type: 'integer',
            minimum: 1,
            description: 'Exclusive cursor from nextBeforeSequence. Omit for the most recent page.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            description: 'Number of messages; default 10.',
          },
        },
      },
    },
    {
      name: ChannelApiName.readMessage,
      description:
        'Read up to 12000 characters of one public message, with author and attachment references. Use a message ID returned by readMessages (or the current request). Follow nextOffset for the remaining text; null means complete.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['messageId'],
        properties: {
          messageId: { type: 'string', description: 'Message ID in the current conversation.' },
          offset: {
            type: 'integer',
            minimum: 0,
            description: 'Character offset from nextOffset. Default 0.',
          },
        },
      },
    },
  ],
};
