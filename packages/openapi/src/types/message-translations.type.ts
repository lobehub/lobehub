import { z } from 'zod';

// ==================== Message Translation Query Types ====================

/**
 * Message translation query request parameters
 */
export interface MessageTranslateQueryRequest {
  messageId: string;
}

export const MessageTranslateQueryRequestSchema = z.object({
  messageId: z.string().min(1, 'message id is required'),
});

/**
 * Message translation params request parameters
 */
export type MessageTranslateParams = MessageTranslateQueryRequest;

// ==================== Message Translation Trigger Types ====================

/**
 * Message translation body request parameters
 */
export interface MessageTranslateBody {
  from?: string;
  model?: string;
  provider?: string;
  to: string;
}

export const MessageTranslateTriggerRequestSchema = z.object({
  from: z.string().optional(),
  model: z.string().nullish(),
  provider: z.string().nullish(),
  to: z.string().min(1, 'target language is required, e.g. en-US, zh-CN'),
});

/**
 * Full message translation trigger request parameters
 */
export type MessageTranslateTriggerRequest = MessageTranslateQueryRequest & MessageTranslateBody;

// ==================== Message Translation Update Types ====================

/**
 * Update translation info request parameters
 */
export type MessageTranslateInfoUpdate = MessageTranslateTriggerRequest & {
  content?: string;
};

export const MessageTranslateInfoUpdateSchema = MessageTranslateTriggerRequestSchema.extend({
  content: z.string().optional(),
});

// ==================== Message Translation Response Types ====================

/**
 * Message translation response parameters
 */
export interface MessageTranslateResponse {
  clientId: string | null;
  content: string | null;
  from: string | null;
  id: string;
  to: string | null;
  userId: string;
}

/**
 * What a translate (POST) or a manual edit (PATCH) answers with: the values
 * just written. `content` is absent on a PATCH that did not send it, `from`
 * when the caller left the source language to detection.
 */
export interface MessageTranslateWriteResponse {
  content?: string;
  from?: string;
  id: string;
  to: string;
  userId: string;
}

// ==================== Response Schemas ====================

export const MessageTranslationSchema = z
  .object({
    clientId: z.string().nullable(),
    content: z.string().nullable(),
    from: z.string().nullable(),
    /** The id of the translated message. */
    id: z.string(),
    to: z.string().nullable(),
    userId: z.string(),
  } satisfies Record<keyof MessageTranslateResponse, z.ZodType>)
  .strict()
  .meta({ id: 'MessageTranslation' });

export const MessageTranslationWriteSchema = z
  .object({
    content: z.string().optional(),
    from: z.string().optional(),
    /** The id of the translated message. */
    id: z.string(),
    to: z.string(),
    userId: z.string(),
  } satisfies Record<keyof MessageTranslateWriteResponse, z.ZodType>)
  .strict()
  .meta({ id: 'MessageTranslationWrite' });
