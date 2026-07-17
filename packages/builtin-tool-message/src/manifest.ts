import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { MessageApiName, MessageToolIdentifier } from './types';

const platformEnum = ['discord', 'telegram', 'slack', 'feishu', 'lark', 'qq', 'wechat'];

/**
 * Shared schema fragment for the outbound `attachments` array on message-
 * sending tools (`sendMessage`, `sendDirectMessage`, `replyToThread`). Mirrors
 * the `SendMessageAttachment` TypeScript type and the TRPC zod schema.
 *
 * Either `data` (base64-encoded bytes) or `fetchUrl` (public URL the
 * platform server can GET) must be provided. `fetchUrl` is preferred when
 * the bytes already live somewhere reachable — base64 inflates the request
 * payload ~33% and many platforms (LINE, QQ guild) can ONLY consume URLs.
 *
 * Platform support varies — see each platform's `sendAttachments` helper
 * for the actual delivery shape:
 * - WeChat / Discord / Telegram / Slack / Feishu / Lark: full support
 * - LINE: image + HTTPS URL only; other types degrade to a text-link line
 * - QQ: group / c2c only; guild / dms / data-only degrade to text-link
 */
const attachmentsSchema = {
  description:
    'Optional outbound media attachments (images / files / video / audio). Each item must provide either `fetchUrl` (preferred — a public URL the platform server fetches) or `data` (base64-encoded bytes). When you have a stable public URL for the file, ALWAYS use `fetchUrl` — base64 bloats the payload and a few platforms (LINE, QQ guild) only accept URLs.',
  items: {
    additionalProperties: false,
    properties: {
      data: {
        description:
          'Base64-encoded bytes. Use only when no public URL exists; prefer `fetchUrl`. Some platforms (LINE, QQ guild) cannot consume this and will fall back to a text-link mention of the attachment.',
        type: 'string',
      },
      fetchUrl: {
        description:
          'Public HTTPS URL the platform server can GET to retrieve the bytes. Preferred over `data`.',
        type: 'string',
      },
      mimeType: {
        description: 'MIME type (e.g. "image/png", "application/pdf"). Optional but helpful.',
        type: 'string',
      },
      name: {
        description:
          'Filename shown to the recipient (e.g. "report.pdf"). Optional; some platforms infer from URL.',
        type: 'string',
      },
      type: {
        description:
          'Media category. Drives which platform-specific endpoint is used (e.g. image → Telegram sendPhoto, file → Telegram sendDocument).',
        enum: ['image', 'file', 'video', 'audio'],
        type: 'string',
      },
    },
    required: ['type'],
    type: 'object',
  },
  type: 'array',
};

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
    watchKeywords: {
      description:
        'Channel-side keyword wake list. When a non-mention message in a non-DM channel contains any of these keywords (case-insensitive, whole-word), the bot wakes without an @mention. If the matched entry has an `instruction`, it is prepended to the user message as an extra prompt before being sent to the AI — so a bare trigger like "bug" can carry a directive ("Scan the recent thread and reply if there is a real bug report"). Empty/absent instructions just wake the bot with the raw user text. Same overwrite-replace semantics as allowFrom — read-modify-write via getBotDetail to add/remove entries.',
      items: {
        additionalProperties: false,
        properties: {
          instruction: {
            description:
              'Optional operator-authored prompt prepended to the user message when this keyword fires. Omit for "just wake the bot" behaviour.',
            type: 'string',
          },
          keyword: {
            description:
              'Trigger word. Lowercased and whole-word matched against inbound message text (Latin scripts use ASCII word boundaries; CJK keywords match as substrings since they have no whitespace boundary).',
            type: 'string',
          },
        },
        required: ['keyword'],
        type: 'object',
      },
      type: 'array',
    },
  },
  type: 'object',
};

export const MessageManifest: BuiltinToolManifest = {
  api: [
    // ==================== Direct Messaging ====================
    {
      description:
        'Send a direct/private message to a user by their platform user ID. Creates a DM channel automatically. Use this when the user asks to "DM me" or "send me a private message". Supports optional outbound media `attachments` (images / files / video / audio). To pick the target: call `listBots` for the platform first — if there\'s an entry, use its `botId`; otherwise call `listMessengers` and use that entry\'s `id` as `messengerInstallationId`.',
      name: MessageApiName.sendDirectMessage,
      parameters: {
        additionalProperties: false,
        properties: {
          attachments: attachmentsSchema,
          botId: {
            description:
              'Per-agent bot id from `listBots`. Provide exactly one of `botId` or `messengerInstallationId`.',
            type: 'string',
          },
          content: {
            description: 'Message content',
            type: 'string',
          },
          messengerInstallationId: {
            description:
              'System Bot installation id from `listMessengers`. Provide exactly one of `botId` or `messengerInstallationId`.',
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
      description:
        "Send a message to a specific channel or conversation on the target platform. Supports optional outbound media `attachments` (images / files / video / audio) — use this when you need to deliver a generated image, document, or other binary alongside your reply. To pick the target: call `listBots` first — if there's an entry for the platform, use its `botId`; otherwise call `listMessengers` and use that entry's `id` as `messengerInstallationId`.",
      name: MessageApiName.sendMessage,
      parameters: {
        additionalProperties: false,
        properties: {
          attachments: attachmentsSchema,
          botId: {
            description:
              'Per-agent bot id from `listBots`. Provide exactly one of `botId` or `messengerInstallationId`.',
            type: 'string',
          },
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
              'Optional array of platform-specific embed objects (Discord embeds, Slack blocks, etc.). For generic file/image delivery use `attachments` instead.',
            items: { type: 'object' },
            type: 'array',
          },
          messengerInstallationId: {
            description:
              'System Bot installation id from `listMessengers`. Provide exactly one of `botId` or `messengerInstallationId`.',
            type: 'string',
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
      description:
        "Send a reply to a thread. Supports optional outbound media `attachments` (images / files / video / audio). To pick the target: call `listBots` first — if there's an entry for the platform, use its `botId`; otherwise call `listMessengers` and use that entry's `id` as `messengerInstallationId`.",
      name: MessageApiName.replyToThread,
      parameters: {
        additionalProperties: false,
        properties: {
          attachments: attachmentsSchema,
          botId: {
            description:
              'Per-agent bot id from `listBots`. Provide exactly one of `botId` or `messengerInstallationId`.',
            type: 'string',
          },
          content: {
            description: 'Reply message content',
            type: 'string',
          },
          messengerInstallationId: {
            description:
              'System Bot installation id from `listMessengers`. Provide exactly one of `botId` or `messengerInstallationId`.',
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
        "List all per-agent bot integrations configured for the current agent (with runtime status). Returns this agent's per-agent bots only — use `listMessengers` to see the user's System Bot installations (a separate outbound channel source). For sending decisions, try `listBots` first; if it has no entry for the target platform, fall back to `listMessengers`.",
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
              'Updated settings (partial update at the key level). See nested field descriptions for the allowed keys (dmPolicy, allowFrom, userId, groupPolicy, groupAllowFrom, serverId, watchKeywords).',
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

    // ==================== System Bot Messenger Management ====================
    {
      description:
        "List the current user's LobeHub System Bot connections (Slack workspaces, Discord guilds, Telegram, and user-owned WeChat accounts). Each entry returns an `id` to pass back as `installationId` on `getMessengerDetail` / `uninstallMessenger`, or as `messengerInstallationId` on send APIs. Use this when the user asks about connected messengers, or as the fallback when `listBots` has no entry for the target platform.",
      name: MessageApiName.listMessengers,
      parameters: {
        additionalProperties: false,
        properties: {},
        type: 'object',
      },
    },
    {
      description:
        'Get detailed metadata about a single System Bot connection. Returns the same fields as `listMessengers` plus `revokedAt` (null when active). Use before `uninstallMessenger` to surface tenant or account info in the confirmation prompt.',
      name: MessageApiName.getMessengerDetail,
      parameters: {
        additionalProperties: false,
        properties: {
          installationId: {
            description: 'Stable connection id from `listMessengers`.',
            type: 'string',
          },
        },
        required: ['installationId'],
        type: 'object',
      },
    },
    {
      description:
        "Disconnect a System Bot connection. **Workspace installs affect every user in that workspace**; a WeChat account connection affects only its owner. For Slack this freezes the workspace's bot since dispatch is gated on the install token; for Discord it removes the audit entry (the bot itself stays in the guild until an admin removes it). Always confirm with the user before calling. To disconnect only the current user's account from a workspace install, use `unlinkMessenger` instead.",
      name: MessageApiName.uninstallMessenger,
      parameters: {
        additionalProperties: false,
        properties: {
          installationId: {
            description: 'Connection id to disconnect.',
            type: 'string',
          },
        },
        required: ['installationId'],
        type: 'object',
      },
    },
    {
      description:
        'List the platforms where the user can connect the LobeHub System Bot. Returns `appId` / `botUsername` when relevant. Use when guiding the user through `Settings → Messenger`; browser OAuth and QR setup flows cannot be initiated from this tool.',
      name: MessageApiName.listMessengerPlatforms,
      parameters: {
        additionalProperties: false,
        properties: {},
        type: 'object',
      },
    },
    {
      description:
        "List the user's per-platform account links — one entry per (platform, tenant). Each link determines which agent receives inbound IM messages from that platform/tenant. Use before `setMessengerActiveAgent` to find the current routing.",
      name: MessageApiName.listMessengerLinks,
      parameters: {
        additionalProperties: false,
        properties: {},
        type: 'object',
      },
    },
    {
      description:
        'Change which agent receives inbound IM messages on a specific platform link. Pass `agentId: null` to clear the active agent (next message gets the "/agents to pick" prompt). Pass `tenantId` to scope to one Slack workspace; omit for Telegram and WeChat.',
      name: MessageApiName.setMessengerActiveAgent,
      parameters: {
        additionalProperties: false,
        properties: {
          agentId: {
            description:
              'Agent id to route to, or null to clear. The agent must belong to the current user.',
            type: ['string', 'null'],
          },
          platform: {
            description: 'Target platform',
            enum: platformEnum,
            type: 'string',
          },
          tenantId: {
            description: 'Optional tenant scope (Slack workspace id).',
            type: 'string',
          },
        },
        required: ['platform', 'agentId'],
        type: 'object',
      },
    },
    {
      description:
        "Remove the current user's account link for a platform. The workspace install stays — other users can still use the System Bot in that workspace; only the current user's inbound routing is removed. To revoke the install for everyone, use `uninstallMessenger`.",
      name: MessageApiName.unlinkMessenger,
      parameters: {
        additionalProperties: false,
        properties: {
          platform: {
            description: 'Target platform',
            enum: platformEnum,
            type: 'string',
          },
          tenantId: {
            description: 'Optional tenant scope (Slack workspace id).',
            type: 'string',
          },
        },
        required: ['platform'],
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
