import type { IPluginErrorType } from '@lobehub/chat-plugin-sdk';
import { z } from 'zod';

import type { ILobeAgentRuntimeErrorType } from '../../agentRuntime';
import type { ErrorType } from '../../fetch';

/**
 * Chat message error object
 */
export interface ChatMessageError {
  body?: any;
  message?: string;
  type: ErrorType | IPluginErrorType | ILobeAgentRuntimeErrorType;
}

export const ChatMessageErrorSchema = z.object({
  body: z.any().optional(),
  message: z.string().optional(),
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
