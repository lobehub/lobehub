import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { MessageApiName, MessageToolIdentifier } from './types';

const platformEnum = ['discord', 'telegram', 'slack', 'googlechat', 'irc'];

export const MessageManifest: BuiltinToolManifest = {
  api: [
    // ==================== Core Message Operations ====================
    {
      description:
        'Send a message to a specific channel or conversation on the target platform.',
      name: MessageApiName.sendMessage,
      parameters: {
        additionalProperties: false,
        properties: {
          channelId: {
            description: 'Channel / conversation / room ID to send the message to',
            type: 'string',
          },
          content: {
            description:
              'Message content. Supports text and markdown depending on platform capabilities.',
            type: 'string',
          },
          embeds: {
            description:
              'Optional array of embed/attachment objects (platform-specific structure)',
            items: { type: 'object' },
            type: 'array',
          },
          platform: {
            description: 'Target messaging platform',
            enum: platformEnum,
            type: 'string',
          },
          replyTo: {
            description: 'Optional message ID to reply to',
            type: 'string',
          },
        },
        required: ['platform', 'channelId', 'content'],
        type: 'object',
      },
    },
    {
      description:
        'Read recent messages from a channel or conversation. Returns messages in chronological order.',
      name: MessageApiName.readMessages,
      parameters: {
        additionalProperties: false,
        properties: {
          after: {
            description: 'Read messages after this message ID (for pagination)',
            type: 'string',
          },
          before: {
            description: 'Read messages before this message ID (for pagination)',
            type: 'string',
          },
          channelId: {
            description: 'Channel / conversation / room ID to read from',
            type: 'string',
          },
          limit: {
            default: 50,
            description: 'Maximum number of messages to fetch (default: 50, max: 100)',
            maximum: 100,
            minimum: 1,
            type: 'integer',
          },
          platform: {
            description: 'Target messaging platform',
            enum: platformEnum,
            type: 'string',
          },
        },
        required: ['platform', 'channelId'],
        type: 'object',
      },
    },
    {
      description: 'Edit an existing message. Only the message author can edit their messages.',
      name: MessageApiName.editMessage,
      parameters: {
        additionalProperties: false,
        properties: {
          channelId: {
            description: 'Channel ID where the message is located',
            type: 'string',
          },
          content: {
            description: 'New message content',
            type: 'string',
          },
          messageId: {
            description: 'ID of the message to edit',
            type: 'string',
          },
          platform: {
            description: 'Target messaging platform',
            enum: platformEnum,
            type: 'string',
          },
        },
        required: ['platform', 'channelId', 'messageId', 'content'],
        type: 'object',
      },
    },
    {
      description:
        'Delete a message from a channel. Requires appropriate permissions.',
      name: MessageApiName.deleteMessage,
      parameters: {
        additionalProperties: false,
        properties: {
          channelId: {
            description: 'Channel ID where the message is located',
            type: 'string',
          },
          messageId: {
            description: 'ID of the message to delete',
            type: 'string',
          },
          platform: {
            description: 'Target messaging platform',
            enum: platformEnum,
            type: 'string',
          },
        },
        required: ['platform', 'channelId', 'messageId'],
        type: 'object',
      },
    },
    {
      description:
        'Search for messages in a channel matching a query string. Supports optional author filtering.',
      name: MessageApiName.searchMessages,
      parameters: {
        additionalProperties: false,
        properties: {
          authorId: {
            description: 'Optional: filter results by author/user ID',
            type: 'string',
          },
          channelId: {
            description: 'Channel ID to search in',
            type: 'string',
          },
          limit: {
            default: 25,
            description: 'Maximum number of results to return (default: 25)',
            maximum: 100,
            minimum: 1,
            type: 'integer',
          },
          platform: {
            description: 'Target messaging platform',
            enum: platformEnum,
            type: 'string',
          },
          query: {
            description: 'Search query string',
            type: 'string',
          },
        },
        required: ['platform', 'channelId', 'query'],
        type: 'object',
      },
    },

    // ==================== Reactions ====================
    {
      description: 'Add an emoji reaction to a message.',
      name: MessageApiName.reactToMessage,
      parameters: {
        additionalProperties: false,
        properties: {
          channelId: {
            description: 'Channel ID',
            type: 'string',
          },
          emoji: {
            description:
              'Emoji to react with. Use unicode emoji (e.g. "👍") or platform-specific format (e.g. Discord custom emoji ":custom_emoji:123456")',
            type: 'string',
          },
          messageId: {
            description: 'Message ID to react to',
            type: 'string',
          },
          platform: {
            description: 'Target messaging platform',
            enum: platformEnum,
            type: 'string',
          },
        },
        required: ['platform', 'channelId', 'messageId', 'emoji'],
        type: 'object',
      },
    },
    {
      description: 'Get all reactions on a specific message.',
      name: MessageApiName.getReactions,
      parameters: {
        additionalProperties: false,
        properties: {
          channelId: {
            description: 'Channel ID',
            type: 'string',
          },
          messageId: {
            description: 'Message ID to get reactions for',
            type: 'string',
          },
          platform: {
            description: 'Target messaging platform',
            enum: platformEnum,
            type: 'string',
          },
        },
        required: ['platform', 'channelId', 'messageId'],
        type: 'object',
      },
    },

    // ==================== Pin Management ====================
    {
      description: 'Pin a message in a channel.',
      name: MessageApiName.pinMessage,
      parameters: {
        additionalProperties: false,
        properties: {
          channelId: {
            description: 'Channel ID',
            type: 'string',
          },
          messageId: {
            description: 'Message ID to pin',
            type: 'string',
          },
          platform: {
            description: 'Target messaging platform',
            enum: platformEnum,
            type: 'string',
          },
        },
        required: ['platform', 'channelId', 'messageId'],
        type: 'object',
      },
    },
    {
      description: 'Unpin a message from a channel.',
      name: MessageApiName.unpinMessage,
      parameters: {
        additionalProperties: false,
        properties: {
          channelId: {
            description: 'Channel ID',
            type: 'string',
          },
          messageId: {
            description: 'Message ID to unpin',
            type: 'string',
          },
          platform: {
            description: 'Target messaging platform',
            enum: platformEnum,
            type: 'string',
          },
        },
        required: ['platform', 'channelId', 'messageId'],
        type: 'object',
      },
    },
    {
      description: 'List all pinned messages in a channel.',
      name: MessageApiName.listPins,
      parameters: {
        additionalProperties: false,
        properties: {
          channelId: {
            description: 'Channel ID',
            type: 'string',
          },
          platform: {
            description: 'Target messaging platform',
            enum: platformEnum,
            type: 'string',
          },
        },
        required: ['platform', 'channelId'],
        type: 'object',
      },
    },

    // ==================== Channel Management ====================
    {
      description: 'Get information about a specific channel or conversation.',
      name: MessageApiName.getChannelInfo,
      parameters: {
        additionalProperties: false,
        properties: {
          channelId: {
            description: 'Channel ID to get info for',
            type: 'string',
          },
          platform: {
            description: 'Target messaging platform',
            enum: platformEnum,
            type: 'string',
          },
        },
        required: ['platform', 'channelId'],
        type: 'object',
      },
    },
    {
      description: 'List available channels in a server or workspace.',
      name: MessageApiName.listChannels,
      parameters: {
        additionalProperties: false,
        properties: {
          filter: {
            description: 'Optional filter by category or channel type',
            type: 'string',
          },
          platform: {
            description: 'Target messaging platform',
            enum: platformEnum,
            type: 'string',
          },
          serverId: {
            description:
              'Server / workspace / organization ID. Required for platforms with multi-server support (Discord, Slack).',
            type: 'string',
          },
        },
        required: ['platform'],
        type: 'object',
      },
    },

    // ==================== Member Information ====================
    {
      description: 'Get information about a specific member or user.',
      name: MessageApiName.getMemberInfo,
      parameters: {
        additionalProperties: false,
        properties: {
          memberId: {
            description: 'Member / user ID to look up',
            type: 'string',
          },
          platform: {
            description: 'Target messaging platform',
            enum: platformEnum,
            type: 'string',
          },
          serverId: {
            description:
              'Server / workspace ID. Required for some platforms to scope the lookup.',
            type: 'string',
          },
        },
        required: ['platform', 'memberId'],
        type: 'object',
      },
    },

    // ==================== Thread Operations ====================
    {
      description:
        'Create a new thread in a channel. On Discord, creates a thread from a message or as a standalone thread. On Slack, starts a thread reply chain.',
      name: MessageApiName.createThread,
      parameters: {
        additionalProperties: false,
        properties: {
          channelId: {
            description: 'Channel ID to create the thread in',
            type: 'string',
          },
          content: {
            description: 'Optional initial message content for the thread',
            type: 'string',
          },
          messageId: {
            description: 'Optional message ID to create thread from (platform-specific)',
            type: 'string',
          },
          name: {
            description: 'Thread name / title',
            type: 'string',
          },
          platform: {
            description: 'Target messaging platform',
            enum: platformEnum,
            type: 'string',
          },
        },
        required: ['platform', 'channelId', 'name'],
        type: 'object',
      },
    },
    {
      description: 'List threads in a channel.',
      name: MessageApiName.listThreads,
      parameters: {
        additionalProperties: false,
        properties: {
          channelId: {
            description: 'Channel ID',
            type: 'string',
          },
          platform: {
            description: 'Target messaging platform',
            enum: platformEnum,
            type: 'string',
          },
        },
        required: ['platform', 'channelId'],
        type: 'object',
      },
    },
    {
      description: 'Send a reply to a thread.',
      name: MessageApiName.replyToThread,
      parameters: {
        additionalProperties: false,
        properties: {
          content: {
            description: 'Reply message content',
            type: 'string',
          },
          platform: {
            description: 'Target messaging platform',
            enum: platformEnum,
            type: 'string',
          },
          threadId: {
            description: 'Thread ID to reply in',
            type: 'string',
          },
        },
        required: ['platform', 'threadId', 'content'],
        type: 'object',
      },
    },

    // ==================== Platform-Specific: Polls ====================
    {
      description:
        'Create a poll in a channel. Supported on platforms with native poll features (Discord, Telegram).',
      name: MessageApiName.createPoll,
      parameters: {
        additionalProperties: false,
        properties: {
          channelId: {
            description: 'Channel ID to create the poll in',
            type: 'string',
          },
          duration: {
            description: 'Poll duration in hours (platform-specific limits apply)',
            minimum: 1,
            type: 'integer',
          },
          multipleAnswers: {
            description: 'Whether to allow multiple answers (default: false)',
            type: 'boolean',
          },
          options: {
            description: 'Array of poll options / answer choices',
            items: { type: 'string' },
            minItems: 2,
            type: 'array',
          },
          platform: {
            description: 'Target messaging platform',
            enum: platformEnum,
            type: 'string',
          },
          question: {
            description: 'The poll question',
            type: 'string',
          },
        },
        required: ['platform', 'channelId', 'question', 'options'],
        type: 'object',
      },
    },
  ],
  identifier: MessageToolIdentifier,
  meta: {
    avatar: '💬',
    description:
      'Send, read, edit, and manage messages across multiple messaging platforms with a unified interface',
    readme:
      'Cross-platform messaging tool supporting Discord, Telegram, Slack, Google Chat, and IRC. Provides unified APIs for message operations, reactions, pins, threads, channel management, and platform-specific features like polls.',
    title: 'Message',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
