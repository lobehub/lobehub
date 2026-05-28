import { z } from 'zod';

import type { ILobeAgentRuntimeErrorType } from '../../agentRuntime';
import type { ErrorType } from '../../fetch';
import type { IToolErrorType } from '../../tool/error';

/**
 * Orthogonal to `type`: `type` says *what* the error is, the four fields below
 * say *how to react to it*. Sourced from `ERROR_CODE_SPECS` in `model-runtime`
 * at the point where a thrown error is normalized into `ChatMessageError`, so
 * downstream consumers (DB JSONB, S3 snapshot, gateway WS push, dashboards)
 * don't have to redo the classification themselves.
 *
 * All fields are optional — codes not registered in `ERROR_CODE_SPECS` (or
 * fallback shapes like `InternalServerError`) will not carry them.
 */
export type ChatMessageErrorAttribution = 'user' | 'provider' | 'harness' | 'system';
export type ChatMessageErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

/**
 * Chat message error object
 */
export interface ChatMessageError {
  /** Who owns the fix — surfaces user-vs-harness split on dashboards. */
  attribution?: ChatMessageErrorAttribution;
  body?: any;
  /** Semantic bucket for slicing (auth / quota / capacity / …). */
  category?: string;
  /** Whether this counts toward operational failure metrics. */
  countAsFailure?: boolean;
  /** HTTP status the runtime returned (or would return) for this error. */
  httpStatus?: number;
  /**
   * Whether this code is a catch-all / under-classified bucket (e.g.
   * ProviderBizError, UpstreamHttpError, AgentRuntimeError, DatabasePersistError).
   * Monitoring tracks fallback-bucket volume to decide where finer codes are
   * still needed.
   */
  isFallback?: boolean;
  message?: string;
  /** Stable `E<numericId>` reference for docs / support tickets. */
  numericId?: number;
  /** Transport-level retryability hint. */
  retryable?: boolean;
  severity?: ChatMessageErrorSeverity;
  type: ErrorType | IToolErrorType | ILobeAgentRuntimeErrorType;
}

export const ChatMessageErrorSchema = z.object({
  attribution: z.enum(['user', 'provider', 'harness', 'system']).optional(),
  body: z.any().optional(),
  category: z.string().optional(),
  countAsFailure: z.boolean().optional(),
  httpStatus: z.number().optional(),
  isFallback: z.boolean().optional(),
  message: z.string().optional(),
  numericId: z.number().optional(),
  retryable: z.boolean().optional(),
  severity: z.enum(['info', 'warning', 'error', 'critical']).optional(),
  type: z.union([z.string(), z.number()]),
});

export interface ChatCitationItem {
  id?: string;
  onlyUrl?: boolean;
  title?: string;
  url: string;
}

/**
 * Message content part types for multimodal content support
 */
export interface MessageContentPartText {
  text: string;
  thoughtSignature?: string;
  type: 'text';
}

export interface MessageContentPartImage {
  image: string;
  thoughtSignature?: string;
  type: 'image';
}

export type MessageContentPart = MessageContentPartText | MessageContentPartImage;

export interface ModelReasoning {
  /**
   * Reasoning content, can be plain string or serialized JSON array of MessageContentPart[]
   */
  content?: string;
  duration?: number;
  /**
   * Flag indicating if content is multimodal (serialized MessageContentPart[])
   */
  isMultimodal?: boolean;
  signature?: string;
  tempDisplayContent?: MessageContentPart[];
}

export const ModelReasoningSchema = z.object({
  content: z.string().optional(),
  duration: z.number().optional(),
  isMultimodal: z.boolean().optional(),
  signature: z.string().optional(),
});
