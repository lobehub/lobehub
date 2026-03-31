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
