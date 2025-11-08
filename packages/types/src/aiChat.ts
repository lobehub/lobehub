import { z } from 'zod';

import { UIChatMessage } from './message';
import { OpenAIChatMessage } from './openai/chat';
import { LobeUniformTool, LobeUniformToolSchema } from './tool';
import { ChatTopic } from './topic';

export interface SendNewMessage {
  content: string;
  // if message has attached with files, then add files to message and the agent
  files?: string[];
}

export interface SendMessageServerParams {
  newAssistantMessage: {
    model: string;
    provider: string;
  };
  newTopic?: {
    title?: string;
    topicMessageIds?: string[];
  };
  newUserMessage: SendNewMessage;
  sessionId?: string;
  threadId?: string;
  // if there is activeTopicId，then add topicId to message
  topicId?: string;
}

export const AiSendMessageServerSchema = z.object({
  newAssistantMessage: z.object({
    model: z.string().optional(),
    provider: z.string().optional(),
  }),
  newTopic: z
    .object({
      title: z.string().optional(),
      topicMessageIds: z.array(z.string()).optional(),
    })
    .optional(),
  newUserMessage: z.object({
    content: z.string(),
    files: z.array(z.string()).optional(),
  }),
  sessionId: z.string().optional(),
  threadId: z.string().optional(),
  topicId: z.string().optional(),
});

export interface SendMessageServerResponse {
  assistantMessageId: string;
  isCreateNewTopic: boolean;
  messages: UIChatMessage[];
  topicId: string;
  topics?: ChatTopic[];
  userMessageId: string;
}

export const StructureSchema = z.object({
  description: z.string().optional(),
  name: z.string(),
  schema: z.object({
    $defs: z.any().optional(),
    additionalProperties: z.boolean().optional(),
    properties: z.record(z.string(), z.any()),
    required: z.array(z.string()).optional(),
    type: z.literal('object'),
  }),
  strict: z.boolean().optional(),
});

export const StructureOutputSchema = z.object({
  keyVaultsPayload: z.string(),
  messages: z.array(z.any()),
  model: z.string(),
  provider: z.string(),
  schema: StructureSchema.optional(),
  tools: z
    .array(z.object({ function: LobeUniformToolSchema, type: z.literal('function') }))
    .optional(),
});

interface IStructureSchema {
  description: string;
  name: string;
  schema: {
    additionalProperties?: boolean;
    properties: Record<string, any>;
    required?: string[];
    type: 'object';
  };
  strict?: boolean;
}

export interface StructureOutputParams {
  keyVaultsPayload: string;
  messages: OpenAIChatMessage[];
  model: string;
  provider: string;
  schema?: IStructureSchema;
  systemRole?: string;
  tools?: {
    function: LobeUniformTool;
    type: 'function';
  }[];
}
