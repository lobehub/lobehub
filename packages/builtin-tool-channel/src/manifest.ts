import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { ChannelApiName, ChannelIdentifier } from './types';

export const ChannelManifest: BuiltinToolManifest = {
  identifier: ChannelIdentifier,
  type: 'builtin',
  systemRole: systemPrompt,
  meta: {
    avatar: '#',
    title: 'Channel',
    description: 'Read the current shared conversation, and message Agents in your other Channels.',
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
    {
      name: ChannelApiName.listChannels,
      description:
        "List the Channels your requester belongs to, newest first, with each Channel's Agent members (agentId, name, description). Use it to find where to reach another Agent before sendMessage. The Channel you are answering in is marked current. Filter with agentId (Channels that Agent is in) or query (Channel title or Agent name). Default 10, maximum 20.",
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          agentId: {
            type: 'string',
            description: 'Only Channels where this Agent is a member.',
          },
          query: {
            type: 'string',
            description: 'Case-insensitive match on the Channel title or an Agent member name.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            description: 'Number of Channels; default 10.',
          },
        },
      },
    },
    {
      name: ChannelApiName.sendMessage,
      description:
        "Ask or tell another Agent something. Address one Agent by agentIds: it is asked in the conversation between you two, never in the person's conversation or a group; its answer wakes you there, and what you then write is posted back where you asked. To address several Agents together, also give channelId, a group they are all in: the message appears as your requester's, marked as relayed by you, they answer in that group, and the reply is brought back to you here as a new request. Find agentIds with listChannels. The person sees a notice of the message where you are answering, so do not paste a link or open a Thread for it: say briefly what you asked and that the answer will follow.",
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['agentIds', 'content'],
        properties: {
          agentIds: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 5,
            description: 'Agents to address. One Agent is asked directly; several need channelId.',
          },
          channelId: {
            type: 'string',
            description:
              'A group Channel from listChannels that every addressed Agent is in. Only for several Agents.',
          },
          content: {
            type: 'string',
            description:
              'The message, self-contained: the addressed Agent does not see this conversation.',
          },
        },
      },
    },
  ],
};
