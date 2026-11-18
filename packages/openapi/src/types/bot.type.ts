import { z } from 'zod';

import { BOT_RUNTIME_STATUSES, type BotRuntimeStatus } from '@/types/botRuntimeStatus';

import { CursorPaginationQuerySchema, paginatedListSchema } from '../helpers/pagination';
import { dateTimeSchema, jsonObjectSchema } from './common.type';

// ==================== Path / Query Schemas ====================

export const BotIdParamSchema = z.object({ id: z.string().min(1) });
export type BotIdParam = z.infer<typeof BotIdParamSchema>;

export const BotListQuerySchema = CursorPaginationQuerySchema.extend({
  agentId: z.string().min(1).optional().describe('Only bots wired to this agent.'),
  platform: z.string().min(1).optional().describe('Only bots on this platform, e.g. `webhook`.'),
});
export type BotListQuery = z.infer<typeof BotListQuerySchema>;

// ==================== Shared fields ====================

/** The runtime states `getBotRuntimeStatus` reports. */
const BOT_RUNTIME_STATUS_VALUES = Object.values(BOT_RUNTIME_STATUSES) as [
  BotRuntimeStatus,
  ...BotRuntimeStatus[],
];

const BotPlatformSchema = z
  .string()
  .min(1)
  .max(50)
  .describe(
    'Platform id, e.g. `webhook` (the custom webhook channel), `discord`, `slack`, `telegram`, `feishu`.',
  );

const BotApplicationIdSchema = z
  .string()
  .min(1)
  .max(255)
  .describe(
    "The platform's bot / application id; for `webhook`, the Bot ID you choose (3–64 letters, digits, `-` or `_`). Unique per platform across the deployment.",
  );

const BotCredentialsSchema = z
  .record(z.string(), z.string())
  .describe(
    'Platform credentials, e.g. `{ "callbackUrl": "https://…", "signingSecret": "…" }` for `webhook`. Responses mask every secret.',
  );

const BotSettingsSchema = jsonObjectSchema.describe(
  'Platform settings (reply limits, DM / group policy, concurrency …). Omitted keys take the platform default.',
);

// ==================== Request Schemas ====================

export const CreateBotRequestSchema = z
  .object({
    agentId: z.string().min(1).describe('The agent that answers on this bot.'),
    applicationId: BotApplicationIdSchema,
    credentials: BotCredentialsSchema,
    enabled: z.boolean().optional().describe('Defaults to `true`.'),
    platform: BotPlatformSchema,
    settings: BotSettingsSchema.optional(),
  })
  .strict();
export type CreateBotRequest = z.infer<typeof CreateBotRequestSchema>;

export const UpdateBotRequestSchema = z
  .object({
    applicationId: BotApplicationIdSchema.optional(),
    credentials: BotCredentialsSchema.optional().describe(
      'Replaces the credentials. A masked value read back from `GET` keeps the stored secret.',
    ),
    settings: BotSettingsSchema.optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'At least one field must be provided',
  });
export type UpdateBotRequest = z.infer<typeof UpdateBotRequestSchema>;

const BotMessageAttachmentSchema = z
  .object({
    data: z.string().optional().describe('Base64 bytes, when there is no `fetchUrl`.'),
    fetchUrl: z.url().optional().describe('A public URL the platform can download.'),
    mimeType: z.string().max(255).optional(),
    name: z.string().max(255).optional(),
    type: z.enum(['image', 'file', 'video', 'audio']),
  })
  .strict()
  .refine((value) => Boolean(value.data || value.fetchUrl), {
    message: 'Provide data or fetchUrl',
  });

export const SendBotMessageRequestSchema = z
  .object({
    attachments: z.array(BotMessageAttachmentSchema).max(10).optional(),
    channelId: z
      .string()
      .min(1)
      .describe(
        'Where to post: the platform channel / chat id. For `webhook`, a conversation id, or a full `webhook:<direct|group>:<conversationId>[:<threadId>]` thread id.',
      ),
    content: z.string().min(1).max(32_000).describe('Message text (Markdown).'),
    replyTo: z.string().min(1).optional().describe('Platform message id to reply to.'),
  })
  .strict();
export type SendBotMessageRequest = z.infer<typeof SendBotMessageRequestSchema>;

// ==================== Response Schemas ====================

export const BotSchema = z
  .object({
    agentId: z.string(),
    applicationId: z.string(),
    createdAt: dateTimeSchema,
    credentials: BotCredentialsSchema,
    enabled: z.boolean(),
    id: z.string().describe('Use as `{id}` in `/bots/{id}` and as `{botId}` in the webhook URL.'),
    platform: z.string(),
    runtimeStatus: z
      .enum(BOT_RUNTIME_STATUS_VALUES)
      .describe('Connection state as last reported by the runtime.'),
    settings: BotSettingsSchema,
    updatedAt: dateTimeSchema,
    workspaceId: z.string().nullable(),
  })
  .strict()
  .meta({ id: 'Bot' });
export type BotResponse = z.infer<typeof BotSchema>;

export const BotListResponseSchema = paginatedListSchema(BotSchema, { total: true });

export const BotConnectionTestSchema = z
  .object({
    errors: z
      .array(
        z
          .object({
            code: z.string().optional().describe('Stable error code, when the platform gives one.'),
            field: z.string().describe('The credential or setting the check failed on.'),
            message: z.string(),
          })
          .strict(),
      )
      .describe('Why the check failed; empty when `valid`.'),
    valid: z.boolean(),
  })
  .strict()
  .meta({ id: 'BotConnectionTest' });
export type BotConnectionTest = z.infer<typeof BotConnectionTestSchema>;

export const BotMessageSentSchema = z
  .object({
    channelId: z.string(),
    messageId: z.string().describe("The platform's id for the posted message."),
    platform: z.string(),
  })
  .strict()
  .meta({ id: 'BotMessageSent' });
export type BotMessageSent = z.infer<typeof BotMessageSentSchema>;
