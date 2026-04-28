import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { MessageApiName, MessageToolIdentifier } from './types';

const platformEnum = ['discord', 'telegram', 'slack', 'feishu', 'lark', 'qq', 'wechat'];

/**
 * Schema for the bot's `settings` JSON column. Both `createBot` and
 * `updateBot` accept a partial object — only the keys you pass are written
 * (everything else preserved). Use this as the single source of truth for
 * what the AI is allowed to toggle on a bot.
 */
const botSettingsSchema = {
  additionalProperties: true,
  properties: {
    allowFrom: {
      description:
        'Global user-ID allowlist. When non-empty, ONLY listed users may interact with the bot anywhere — DMs, group @mentions, threads — regardless of dmPolicy/groupPolicy. Empty array means "no user-level filter". Pass the FULL desired list (this field is overwrite-replace, not append): to add or remove a single user, first call getBotDetail to read settings.allowFrom, mutate locally, then write back the entire array.',
      items: {
        additionalProperties: false,
        properties: {
          id: {
            description: 'Platform user ID (e.g. Discord snowflake, Telegram user_id)',
            type: 'string',
          },
          name: {
            description:
              'Optional human-friendly label so the operator can recognise the entry later (e.g. "Ada from Product"). Runtime ignores this; only id is matched.',
            type: 'string',
          },
        },
        required: ['id'],
        type: 'object',
      },
      type: 'array',
    },
    dmPolicy: {
      description:
        'Direct-message gate. open=accept DMs from anyone (default); allowlist=only users in allowFrom can DM, fails closed if list is empty; pairing=non-listed senders get a one-time code and the owner runs /approve <code> to add them; disabled=ignore all DMs. pairing requires settings.userId (owner platform ID).',
      enum: ['open', 'allowlist', 'pairing', 'disabled'],
      type: 'string',
    },
    groupAllowFrom: {
      description:
        'Channel/group/thread ID allowlist for group traffic. Only consulted when groupPolicy="allowlist". Same overwrite-replace semantics as allowFrom — read-modify-write to add/remove entries.',
      items: {
        additionalProperties: false,
        properties: {
          id: {
            description:
              'Channel / group / thread ID (e.g. Discord channel ID copied via "Copy Channel ID")',
            type: 'string',
          },
          name: { description: 'Optional human-friendly label.', type: 'string' },
        },
        required: ['id'],
        type: 'object',
      },
      type: 'array',
    },
    groupPolicy: {
      description:
        'Group/channel @mention gate. open=respond to @mentions in any channel (default); allowlist=respond only in channels listed in groupAllowFrom; disabled=ignore all non-DM traffic.',
      enum: ['open', 'allowlist', 'disabled'],
      type: 'string',
    },
    serverId: {
      description:
        'Default server / guild / workspace ID used when the AI calls listChannels/getMemberInfo without an explicit serverId. Optional; populated automatically once the bot has been used in a server.',
      type: 'string',
    },
    userId: {
      description:
        "The bot owner's platform user ID. Required when dmPolicy='pairing' (used as approver identity and as an implicit member of allowFrom). Also used to push owner-only notifications.",
      type: 'string',
    },
  },
  type: 'object',
};

export const MessageManifest: BuiltinToolManifest = {
  api: [
    // ==================== Direct Messaging ====================
    {
      description:
        'Send a direct/private message to a user by their platform user ID. Creates a DM channel automatically. Use this when the user asks to "DM me" or "send me a private message".',
      name: MessageApiName.sendDirectMessage,
      parameters: {
        additionalProperties: false,
        properties: {
          content: {
            description: 'Message content',
            type: 'string',
          },
          platform: {
            description: 'Target messaging platform',
            enum: platformEnum,
            type: 'string',
          },
          userId: {
            description: 'Target user ID on the platform (e.g. Discord user ID)',
            type: 'string',
          },
        },
        required: ['platform', 'userId', 'content'],
        type: 'object',
      },
    },

    // ==================== Core Message Operations ====================
    {
      description: 'Send a message to a specific channel or conversation on the target platform.',
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
            description: 'Optional array of embed/attachment objects (platform-specific structure)',
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
      description: `Read recent messages from a channel or conversation. Returns messages in chronological order.`,
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
          cursor: {
            description:
              'Pagination cursor from a previous readMessages response (nextCursor). When provided, fetches the next page. Used by Feishu/Lark.',
            type: 'string',
          },
          endTime: {
            description:
              'End time as Unix second timestamp. Used by Feishu/Lark to filter messages before this time.',
            type: 'string',
          },
          platform: {
            description: 'Target messaging platform',
            enum: platformEnum,
            type: 'string',
          },
          startTime: {
            description:
              'Start time as Unix second timestamp. Used by Feishu/Lark to filter messages after this time.',
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
      description: 'Delete a message from a channel. Requires appropriate permissions.',
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
            description: 'Server / workspace ID. Required for some platforms to scope the lookup.',
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

    // ==================== Bot Management ====================
    {
      description:
        'List all supported messaging platforms and their required credential fields. Use this to guide users when setting up a new bot.',
      name: MessageApiName.listPlatforms,
      parameters: {
        additionalProperties: false,
        properties: {},
        type: 'object',
      },
    },
    {
      description:
        'List all configured bot integrations for the current agent. Use this first to discover which platforms are connected and get bot IDs.',
      name: MessageApiName.listBots,
      parameters: {
        additionalProperties: false,
        properties: {},
        type: 'object',
      },
    },
    {
      description: 'Get detailed information about a specific bot integration.',
      name: MessageApiName.getBotDetail,
      parameters: {
        additionalProperties: false,
        properties: {
          botId: {
            description: 'Bot integration ID',
            type: 'string',
          },
        },
        required: ['botId'],
        type: 'object',
      },
    },
    {
      description:
        'Create a new bot integration for a platform. Call listPlatforms first to see required credentials.',
      name: MessageApiName.createBot,
      parameters: {
        additionalProperties: false,
        properties: {
          agentId: {
            description: 'Agent ID to attach the bot to',
            type: 'string',
          },
          applicationId: {
            description: 'Application ID for webhook routing (platform-specific)',
            type: 'string',
          },
          credentials: {
            description:
              'Credential key-value pairs. Required fields depend on the platform (e.g. botToken for Discord, appSecret for Feishu).',
            type: 'object',
          },
          platform: {
            description: 'Target platform',
            enum: platformEnum,
            type: 'string',
          },
          settings: {
            ...botSettingsSchema,
            description:
              'Optional initial settings (DM policy, allowlists, owner userId, etc.). Omit to use schema defaults — open DMs, no allowlist. See field descriptions for each key.',
          },
        },
        required: ['platform', 'agentId', 'applicationId', 'credentials'],
        type: 'object',
      },
    },
    {
      description:
        'Update credentials or settings of an existing bot integration. Use this to adjust DM policy (e.g. switch to pairing mode), edit the allowlist, or rotate credentials. Settings is merged at the key level — only keys you pass are written. For array fields like allowFrom/groupAllowFrom, the array is REPLACED, not merged: read-modify-write via getBotDetail before adding/removing entries.',
      name: MessageApiName.updateBot,
      parameters: {
        additionalProperties: false,
        properties: {
          botId: {
            description: 'Bot integration ID',
            type: 'string',
          },
          credentials: {
            description: 'Updated credential key-value pairs (partial update)',
            type: 'object',
          },
          settings: {
            ...botSettingsSchema,
            description:
              'Updated settings (partial update at the key level). See nested field descriptions for the allowed keys (dmPolicy, allowFrom, userId, groupPolicy, groupAllowFrom, serverId).',
          },
        },
        required: ['botId'],
        type: 'object',
      },
    },
    {
      description: 'Delete a bot integration.',
      name: MessageApiName.deleteBot,
      parameters: {
        additionalProperties: false,
        properties: {
          botId: {
            description: 'Bot integration ID to delete',
            type: 'string',
          },
        },
        required: ['botId'],
        type: 'object',
      },
    },
    {
      description: 'Enable or disable a bot integration.',
      name: MessageApiName.toggleBot,
      parameters: {
        additionalProperties: false,
        properties: {
          botId: {
            description: 'Bot integration ID',
            type: 'string',
          },
          enabled: {
            description: 'true to enable, false to disable',
            type: 'boolean',
          },
        },
        required: ['botId', 'enabled'],
        type: 'object',
      },
    },
    {
      description: 'Connect and start a bot. The bot must be enabled and have valid credentials.',
      name: MessageApiName.connectBot,
      parameters: {
        additionalProperties: false,
        properties: {
          botId: {
            description: 'Bot integration ID to connect',
            type: 'string',
          },
        },
        required: ['botId'],
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
