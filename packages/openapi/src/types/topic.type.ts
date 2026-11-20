import type { ChatTopicMetadata, CreateMessageRoleType } from '@lobechat/types';
import { z } from 'zod';

import { THREAD_STATUS, THREAD_TYPE, topics } from '@/database/schemas/topic';

import {
  CursorPaginationQuerySchema,
  pageInfoShape,
  paginatedListSchema,
  totalShape,
} from '../helpers/pagination';
import type { PublicTopic, PublicUser } from '../helpers/public-fields';
import type { IPaginationQuery, PaginationQueryResponse } from './common.type';
import { dateTimeSchema, jsonObjectSchema, PaginationQuerySchema } from './common.type';

// ==================== Topic Query Types ====================

export interface TopicListQuery extends IPaginationQuery {
  agentId?: string | null;
  excludeTriggers?: string[];
  groupId?: string | null;
  includeTriggers?: string[];
  isInbox?: boolean;
}

export const TopicListQuerySchema = z
  .object({
    agentId: z.string().nullish(),
    excludeTriggers: z.array(z.string()).optional(),
    groupId: z.string().nullish(),
    includeTriggers: z.array(z.string()).optional(),
    isInbox: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
  })
  .extend(PaginationQuerySchema.shape);

// ==================== Topic CRUD Types ====================

export interface TopicCreateRequest {
  agentId?: string | null;
  clientId?: string;
  favorite?: boolean;
  groupId?: string | null;
  title: string;
}

export const TopicCreateRequestSchema = z.object({
  agentId: z.string().nullish(),
  clientId: z.string().optional(),
  favorite: z.boolean().optional(),
  groupId: z.string().nullish(),
  title: z.string().min(1, 'Title cannot be empty'),
});

export interface TopicUpdateRequest {
  favorite?: boolean;
  historySummary?: string;
  metadata?: ChatTopicMetadata;
  model?: string;
  provider?: string;
  title?: string;
}

export const TopicUpdateRequestSchema = z
  .object({
    favorite: z.boolean().optional(),
    historySummary: z.string().optional(),
    metadata: z
      .object({
        model: z.string().optional(),
        provider: z.string().optional(),
        boundDeviceId: z.string().optional(),
        workingDirectory: z.string().optional(),
      })
      .optional(),
    model: z
      .string()
      .min(1)
      .optional()
      .describe('Pins the model the topic runs on; send together with `provider`.'),
    provider: z.string().min(1).optional(),
    title: z.string().min(1, 'Title cannot be empty').optional(),
  })
  .refine((value) => (value.model === undefined) === (value.provider === undefined), {
    message: '`model` and `provider` must be sent together',
    path: ['provider'],
  });

// ==================== Topic Response Types ====================

export interface TopicResponse extends PublicTopic {
  messageCount: number;
  user: PublicUser;
}

/**
 * Topic list response type
 */
export type TopicListResponse = PaginationQueryResponse<{
  topics: TopicResponse[];
}>;

// ==================== Common Schemas ====================

export const TopicGetParamSchema = z.object({
  id: z.string().min(1, 'Topic ID cannot be empty'),
});

export const TopicDeleteParamSchema = z.object({
  id: z.string().min(1, 'Topic ID cannot be empty'),
});

export const TopicUpdateParamSchema = z.object({
  id: z.string().min(1, 'Topic ID cannot be empty'),
});

// ==================== Response Schemas ====================

type ShapeOf<T> = Record<keyof T, z.ZodType>;

/** The owner of a topic, projected through `PUBLIC_USER_FIELDS`. */
const TopicOwnerSchema = z
  .object({
    avatar: z.string().nullable(),
    createdAt: dateTimeSchema,
    email: z.string().nullable(),
    firstName: z.string().nullable(),
    fullName: z.string().nullable(),
    id: z.string(),
    isOnboarded: z.boolean().nullable(),
    lastName: z.string().nullable(),
    phone: z.string().nullable(),
    updatedAt: dateTimeSchema,
    username: z.string().nullable(),
  } satisfies ShapeOf<PublicUser>)
  .strict();

/** A topic row projected through `PUBLIC_TOPIC_FIELDS` — what a message embeds. */
export const TopicSummarySchema = z
  .object({
    agentId: z.string().nullable(),
    completedAt: dateTimeSchema.nullable(),
    content: z.string().nullable(),
    cost: jsonObjectSchema.nullable(),
    createdAt: dateTimeSchema,
    description: z.string().nullable(),
    favorite: z.boolean().nullable(),
    groupId: z.string().nullable(),
    historySummary: z.string().nullable(),
    id: z.string(),
    metadata: jsonObjectSchema.nullable(),
    mode: z.string().nullable(),
    model: z.string().nullable(),
    provider: z.string().nullable(),
    sessionId: z.string().nullable(),
    status: z.enum(topics.status.enumValues).nullable(),
    title: z.string().nullable(),
    totalCost: z.number().nullable(),
    totalInputTokens: z.number().int().nullable(),
    totalOutputTokens: z.number().int().nullable(),
    totalTokens: z.number().int().nullable(),
    trigger: z.string().nullable(),
    updatedAt: dateTimeSchema,
    usage: jsonObjectSchema.nullable(),
  } satisfies ShapeOf<PublicTopic>)
  .strict()
  .meta({ id: 'TopicSummary' });

export const TopicSchema = TopicSummarySchema.extend({
  /** Messages stored in the topic. */
  messageCount: z.number().int().min(0),
  user: TopicOwnerSchema,
})
  .strict()
  .meta({ id: 'Topic' });

export const TopicListSchema = z
  .object({ ...pageInfoShape, topics: z.array(TopicSchema), ...totalShape })
  .strict();

export const TopicThreadSchema = z
  .object({
    createdAt: dateTimeSchema,
    id: z.string(),
    parentThreadId: z.string().nullable(),
    status: z.enum(THREAD_STATUS).nullable(),
    title: z.string().nullable(),
    topicId: z.string(),
    type: z.enum(THREAD_TYPE),
    updatedAt: dateTimeSchema,
  })
  .strict()
  .meta({ id: 'TopicThread' });

export const TopicThreadListSchema = z
  .object({ ...pageInfoShape, threads: z.array(TopicThreadSchema), ...totalShape })
  .strict();

// ==================== Topic Branching Types ====================

export const TopicIdParamSchema = z.object({
  id: z.string().min(1, 'Topic ID cannot be empty'),
});

export const TopicCloneRequestSchema = z
  .object({
    title: z.string().min(1).max(255).optional().describe("Defaults to the source's title."),
  })
  .strict();

export const TopicForkRequestSchema = TopicCloneRequestSchema.extend({
  messageId: z
    .string()
    .min(1)
    .describe('The last message to copy: the conversation from the first message to this one.'),
}).strict();

export const TopicBranchRequestSchema = z
  .object({
    content: z.string().min(1).describe('Replacement content for the user message.'),
    messageId: z
      .string()
      .min(1)
      .describe('A user message of the topic. The branch ends at it, with the new content.'),
    title: z.string().min(1).max(255).optional(),
  })
  .strict();

export type TopicCloneRequest = z.infer<typeof TopicCloneRequestSchema>;
export type TopicForkRequest = z.infer<typeof TopicForkRequestSchema>;
export type TopicBranchRequest = z.infer<typeof TopicBranchRequestSchema>;

export const TopicBranchResultSchema = z
  .object({
    messageId: z.string().describe('The edited user message in the new topic.'),
    topic: TopicSchema,
  })
  .strict();

// ==================== Transcript / Export / Import Types ====================

export const TopicTranscriptQuerySchema = z.object({
  cursor: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .describe("Opaque cursor from the previous page's `nextCursor`. Omit for the first page."),
  format: z
    .enum(['json', 'markdown'])
    .default('json')
    .describe('`json` answers message rows; `markdown` answers the page rendered as one document.'),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe('Messages per page, 1–500. Defaults to 50.'),
});

export type TopicTranscriptQuery = z.infer<typeof TopicTranscriptQuerySchema>;

export const TopicTranscriptMessageSchema = z
  .object({
    agentId: z.string().nullable(),
    content: z.string().nullable(),
    createdAt: dateTimeSchema,
    error: jsonObjectSchema.nullable(),
    id: z.string(),
    messageGroupId: z.string().nullable(),
    metadata: jsonObjectSchema.nullable(),
    model: z.string().nullable(),
    parentId: z.string().nullable(),
    pluginError: jsonObjectSchema.nullable(),
    provider: z.string().nullable(),
    reasoning: jsonObjectSchema.nullable(),
    role: z.string(),
    threadId: z.string().nullable(),
    toolCallId: z.string().nullable().describe('Set on a `tool` message: the call it answers.'),
    tools: z.array(jsonObjectSchema).nullable(),
    usage: jsonObjectSchema.nullable(),
  })
  .strict()
  .meta({ id: 'TopicTranscriptMessage' });

const transcriptPageShape = {
  ...pageInfoShape,
  ...totalShape,
  topic: z
    .object({ id: z.string(), title: z.string().nullable(), updatedAt: dateTimeSchema })
    .strict(),
};

export const TopicTranscriptSchema = z.discriminatedUnion('format', [
  z
    .object({
      ...transcriptPageShape,
      format: z.literal('json'),
      items: z.array(TopicTranscriptMessageSchema),
    })
    .strict(),
  z
    .object({
      ...transcriptPageShape,
      format: z.literal('markdown'),
      markdown: z.string().describe('This page of the conversation as Markdown.'),
    })
    .strict(),
]);

export type TopicTranscript = z.infer<typeof TopicTranscriptSchema>;

/**
 * Every role a stored message can carry: what `CreateMessageParams` writes plus
 * `system`. Exports include the runtime's rows too (`verify` delivery-checker
 * cards, `task` / `taskCallback` / `supervisor` turns), so an export only
 * imports back when this contract accepts them.
 */
const STORED_MESSAGE_ROLES = [
  'user',
  'assistant',
  'system',
  'tool',
  'task',
  'supervisor',
  'verify',
  'taskCallback',
] as const satisfies readonly (CreateMessageRoleType | 'system')[];

/** One message of an export: the lossless `version: '2.0'` format the importer reads. */
export const ExportedTopicMessageSchema = z
  .object({
    content: z.string(),
    createdAt: dateTimeSchema,
    error: jsonObjectSchema.optional(),
    id: z.string(),
    metadata: jsonObjectSchema.optional(),
    model: z.string().optional(),
    parentId: z.string().optional(),
    plugin: z
      .object({
        apiName: z.string().nullable(),
        arguments: z.string().nullable(),
        identifier: z.string().nullable(),
        type: z.string().nullable(),
      })
      .strict()
      .optional()
      .describe('Set on a `tool` message: the call it answers.'),
    pluginError: jsonObjectSchema.optional(),
    pluginIntervention: jsonObjectSchema
      .optional()
      .describe('Set on a `tool` message: the intervention payload the chat UI exports.'),
    pluginState: jsonObjectSchema.optional(),
    provider: z.string().optional(),
    reasoning: jsonObjectSchema.optional(),
    role: z.enum(STORED_MESSAGE_ROLES),
    search: jsonObjectSchema.optional(),
    tool_call_id: z.string().optional(),
    tools: z.array(jsonObjectSchema).optional(),
    traceId: z.string().optional(),
    updatedAt: dateTimeSchema,
  })
  .strict()
  .meta({ id: 'ExportedTopicMessage' });

export const ExportedTopicSchema = z
  .object({
    exportedAt: dateTimeSchema,
    messages: z.array(ExportedTopicMessageSchema),
    title: z.string().optional(),
    version: z.literal('2.0'),
  })
  .strict()
  .meta({ id: 'ExportedTopic' });

export type ExportedTopicMessage = z.infer<typeof ExportedTopicMessageSchema>;
export type ExportedTopicPayload = z.infer<typeof ExportedTopicSchema>;

/** Simple import format: OpenAI-style `{ role, content }` turns, chained in order. */
const ImportedMessageSchema = z
  .object({
    content: z.string(),
    createdAt: z.union([dateTimeSchema, z.number()]).optional(),
    id: z.string().optional(),
    model: z.string().optional(),
    parentId: z.string().nullable().optional(),
    provider: z.string().optional(),
    role: z.enum(STORED_MESSAGE_ROLES),
  })
  .meta({ id: 'ImportedTopicMessage' });

export const TopicImportRequestSchema = z
  .object({
    agentId: z.string().min(1).describe('The agent the imported topic belongs to.'),
    data: z
      .union([
        ExportedTopicSchema.describe('What `GET /topics/{id}/export` answers.'),
        z.array(ImportedMessageSchema).min(1),
      ])
      .describe(
        'An export, or a list of `{ role, content }` messages. System messages are dropped.',
      ),
    groupId: z.string().min(1).nullish(),
  })
  .strict();

export type TopicImportRequest = z.infer<typeof TopicImportRequestSchema>;

export const TopicImportResultSchema = z
  .object({ messageCount: z.number().int().min(0), topic: TopicSchema })
  .strict();

// ==================== Search / Batch / Share Types ====================

export const TopicSearchQuerySchema = z.object({
  agentId: z.string().min(1).optional().describe('Only topics of this agent.'),
  groupId: z.string().min(1).optional().describe('Only topics of this group chat.'),
  onlyMine: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true')
    .describe('In a workspace, only topics the caller created.'),
  q: z.string().trim().min(1).max(200).describe('Keywords matched against titles and messages.'),
  ...CursorPaginationQuerySchema.shape,
});

export type TopicSearchQuery = z.infer<typeof TopicSearchQuerySchema>;

export const TopicSearchResultSchema = paginatedListSchema(TopicSummarySchema, { total: true });

export const TopicBatchRequestSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('delete').describe('Moves the topics to the trash.'),
      topicIds: z.array(z.string().min(1)).min(1).max(100),
    })
    .strict(),
  z
    .object({
      action: z.literal('move').describe('Re-homes the topics, with their messages, on an agent.'),
      targetAgentId: z.string().min(1),
      topicIds: z.array(z.string().min(1)).min(1).max(100),
    })
    .strict(),
]);

export type TopicBatchRequest = z.infer<typeof TopicBatchRequestSchema>;

export const TopicBatchResultSchema = z
  .object({
    action: z.enum(['delete', 'move']),
    count: z.number().int().min(0).describe('Topics the call acted on.'),
    movedGoalIds: z
      .array(z.string())
      .describe('Goals supervised from a moved topic that followed it; empty for `delete`.'),
  })
  .strict();

export const TopicShareRequestSchema = z
  .object({
    visibility: z
      .enum(['link', 'private'])
      .describe('`link` publishes the topic to anyone with the URL; `private` revokes it.'),
  })
  .strict();

export type TopicShareRequest = z.infer<typeof TopicShareRequestSchema>;

export const TopicShareSchema = z
  .object({
    shareId: z.string().nullable().describe('`null` once sharing is revoked.'),
    topicId: z.string(),
    url: z.string().nullable().describe('Public URL while `visibility` is `link`.'),
    visibility: z.enum(['link', 'private']),
  })
  .strict()
  .meta({ id: 'TopicShare' });

export type TopicShare = z.infer<typeof TopicShareSchema>;

export const TopicMarkReadSchema = z
  .object({ id: z.string(), wasUnread: z.boolean().describe('Whether the call cleared the mark.') })
  .strict();

// ==================== Thread Types ====================

export const TopicThreadParamSchema = z.object({
  threadId: z.string().min(1),
  topicId: z.string().min(1),
});

export const TopicThreadCreateRequestSchema = z
  .object({
    message: z
      .object({
        content: z.string().min(1),
        role: z.enum(['user', 'assistant']).default('user'),
      })
      .strict()
      .optional()
      .describe('First message of the thread. Its first 80 characters become the title.'),
    parentThreadId: z.string().min(1).optional().describe('Nest under a thread of the topic.'),
    sourceMessageId: z
      .string()
      .min(1)
      .optional()
      .describe('The topic message the thread branches from.'),
    title: z.string().min(1).max(255).optional(),
    type: z.enum(THREAD_TYPE),
  })
  .strict();

export type TopicThreadCreateRequest = z.infer<typeof TopicThreadCreateRequestSchema>;

export const TopicThreadCreateResultSchema = z
  .object({
    messageId: z.string().nullable().describe('The first message, when one was given.'),
    thread: TopicThreadSchema,
  })
  .strict();

export const TopicThreadUpdateRequestSchema = z
  .object({
    status: z.enum(THREAD_STATUS).optional(),
    title: z.string().min(1).max(255).optional(),
  })
  .strict()
  .refine((value) => value.status !== undefined || value.title !== undefined, {
    message: 'Provide at least one field to update',
  });

export type TopicThreadUpdateRequest = z.infer<typeof TopicThreadUpdateRequestSchema>;
