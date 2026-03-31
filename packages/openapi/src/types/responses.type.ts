import { z } from 'zod';

// ==================== Content Types ====================

export const InputTextContentSchema = z.object({
  text: z.string(),
  type: z.literal('input_text'),
});
export type InputTextContent = z.infer<typeof InputTextContentSchema>;

export const OutputTextContentSchema = z.object({
  annotations: z.array(z.any()).optional(),
  logprobs: z.array(z.any()).optional(),
  text: z.string(),
  type: z.literal('output_text'),
});
export type OutputTextContent = z.infer<typeof OutputTextContentSchema>;

export const InputImageContentSchema = z.object({
  detail: z.enum(['auto', 'low', 'high']).optional(),
  image_url: z.string().optional(),
  type: z.literal('input_image'),
});
export type InputImageContent = z.infer<typeof InputImageContentSchema>;

export const InputFileContentSchema = z.object({
  file_data: z.string().optional(),
  file_id: z.string().optional(),
  filename: z.string().optional(),
  type: z.literal('input_file'),
});
export type InputFileContent = z.infer<typeof InputFileContentSchema>;

export const ContentPartSchema = z.discriminatedUnion('type', [
  InputTextContentSchema,
  OutputTextContentSchema,
  InputImageContentSchema,
  InputFileContentSchema,
]);
export type ContentPart = z.infer<typeof ContentPartSchema>;

export const InputContentPartSchema = z.discriminatedUnion('type', [
  InputTextContentSchema,
  InputImageContentSchema,
  InputFileContentSchema,
]);
export type InputContentPart = z.infer<typeof InputContentPartSchema>;

// ==================== Item Types ====================

export const MessageItemSchema = z
  .object({
    content: z.union([z.string(), z.array(ContentPartSchema)]),
    id: z.string().optional(),
    role: z.enum(['user', 'assistant', 'system', 'developer']),
    status: z.enum(['completed', 'in_progress']).optional(),
    type: z.literal('message'),
  })
  .passthrough();
export type MessageItem = z.infer<typeof MessageItemSchema>;

export const FunctionCallItemSchema = z.object({
  arguments: z.string(),
  call_id: z.string().optional(),
  id: z.string().optional(),
  name: z.string(),
  status: z.enum(['completed', 'in_progress']).optional(),
  type: z.literal('function_call'),
});
export type FunctionCallItem = z.infer<typeof FunctionCallItemSchema>;

export const FunctionCallOutputItemSchema = z.object({
  call_id: z.string(),
  id: z.string().optional(),
  output: z.string(),
  status: z.enum(['completed', 'in_progress', 'incomplete']).optional(),
  type: z.literal('function_call_output'),
});
export type FunctionCallOutputItem = z.infer<typeof FunctionCallOutputItemSchema>;

export const ReasoningItemSchema = z.object({
  id: z.string().optional(),
  reasoning_summary: z
    .array(z.object({ text: z.string(), type: z.literal('summary_text') }))
    .optional(),
  type: z.literal('reasoning'),
});
export type ReasoningItem = z.infer<typeof ReasoningItemSchema>;

export const OutputItemSchema = z.discriminatedUnion('type', [
  MessageItemSchema,
  FunctionCallItemSchema,
  FunctionCallOutputItemSchema,
  ReasoningItemSchema,
]);
export type OutputItem = z.infer<typeof OutputItemSchema>;

// Input items: what the user can send
export const InputItemSchema = z.discriminatedUnion('type', [
  MessageItemSchema,
  FunctionCallItemSchema,
  FunctionCallOutputItemSchema,
]);
export type InputItem = z.infer<typeof InputItemSchema>;

// ==================== Tool Types ====================

export const FunctionToolSchema = z.object({
  description: z.string().optional(),
  name: z.string(),
  parameters: z.record(z.any()).optional(),
  strict: z.boolean().optional(),
  type: z.literal('function'),
});
export type FunctionTool = z.infer<typeof FunctionToolSchema>;

export const HostedToolSchema = z.object({
  type: z.string().startsWith('lobe-'),
});
export type HostedTool = z.infer<typeof HostedToolSchema>;

export const ToolSchema = z.union([FunctionToolSchema, HostedToolSchema]);
export type Tool = z.infer<typeof ToolSchema>;

// ==================== Usage Types ====================

export interface ResponseUsage {
  input_tokens: number;
  input_tokens_details?: {
    cached_tokens?: number;
  };
  output_tokens: number;
  output_tokens_details?: {
    reasoning_tokens?: number;
  };
  total_tokens: number;
}

// ==================== Error Types ====================

export type ResponseErrorCode =
  | 'server_error'
  | 'invalid_request_error'
  | 'not_found'
  | 'model_error'
  | 'rate_limit_error';

export interface ResponseError {
  code: ResponseErrorCode;
  message: string;
}

// ==================== Response Status ====================

export type ResponseStatus = 'completed' | 'failed' | 'in_progress' | 'incomplete' | 'queued';

// ==================== Truncation ====================

export const TruncationSchema = z.object({
  type: z.enum(['auto', 'disabled']).default('disabled'),
});
export type Truncation = z.infer<typeof TruncationSchema>;

// ==================== Reasoning ====================

export const ReasoningConfigSchema = z.object({
  effort: z.enum(['low', 'medium', 'high']).optional(),
});
export type ReasoningConfig = z.infer<typeof ReasoningConfigSchema>;

// ==================== Request Schema ====================

export const CreateResponseRequestSchema = z
  .object({
    input: z.union([z.string(), z.array(InputItemSchema)]),
    instructions: z.string().nullish(),
    max_output_tokens: z.number().int().positive().nullish(),
    metadata: z.record(z.string()).nullish(),
    model: z.string(),
    parallel_tool_calls: z.boolean().nullish(),
    previous_response_id: z.string().nullish(),
    reasoning: ReasoningConfigSchema.nullish(),
    stream: z.boolean().nullish(),
    temperature: z.number().min(0).max(2).nullish(),
    tool_choice: z
      .union([
        z.enum(['auto', 'required', 'none']),
        z.object({ name: z.string(), type: z.literal('function') }),
      ])
      .nullish(),
    tools: z.array(ToolSchema).nullish(),
    top_p: z.number().min(0).max(1).nullish(),
    truncation: TruncationSchema.nullish(),
    user: z.string().nullish(),
  })
  .passthrough();

export type CreateResponseRequest = z.infer<typeof CreateResponseRequestSchema>;

// ==================== Response Object ====================

export interface ResponseObject {
  background?: boolean | null;
  completed_at?: number | null;
  created_at: number;
  error?: ResponseError | null;
  frequency_penalty?: number | null;
  id: string;
  incomplete_details?: { reason: string } | null;
  instructions?: string | null;
  max_output_tokens?: number | null;
  metadata?: Record<string, string> | null;
  model: string;
  object: 'response';
  output: OutputItem[];
  output_text: string;
  parallel_tool_calls?: boolean | null;
  presence_penalty?: number | null;
  previous_response_id?: string | null;
  reasoning?: ReasoningConfig | null;
  service_tier?: string | null;
  status: ResponseStatus;
  store?: boolean | null;
  temperature?: number | null;
  text?: { format?: { type: string } };
  tool_choice?: CreateResponseRequest['tool_choice'];
  tools?: Tool[];
  top_p?: number | null;
  truncation?: string | null;
  usage?: ResponseUsage | null;
  user?: string | null;
}

// ==================== SSE Event Types ====================

export type ResponseStreamEventType =
  | 'response.created'
  | 'response.in_progress'
  | 'response.completed'
  | 'response.failed'
  | 'response.incomplete'
  // Output item events
  | 'response.output_item.added'
  | 'response.output_item.done'
  // Content part events
  | 'response.content_part.added'
  | 'response.content_part.done'
  // Text delta events
  | 'response.output_text.delta'
  | 'response.output_text.done'
  // Function call events
  | 'response.function_call_arguments.delta'
  | 'response.function_call_arguments.done'
  // Reasoning events
  | 'response.reasoning_summary_text.delta'
  | 'response.reasoning_summary_text.done';

export interface BaseStreamEvent {
  sequence_number: number;
  type: ResponseStreamEventType;
}

export interface ResponseCreatedEvent extends BaseStreamEvent {
  response: ResponseObject;
  type: 'response.created';
}

export interface ResponseInProgressEvent extends BaseStreamEvent {
  response: ResponseObject;
  type: 'response.in_progress';
}

export interface ResponseCompletedEvent extends BaseStreamEvent {
  response: ResponseObject;
  type: 'response.completed';
}

export interface ResponseFailedEvent extends BaseStreamEvent {
  response: ResponseObject;
  type: 'response.failed';
}

export interface ResponseIncompleteEvent extends BaseStreamEvent {
  response: ResponseObject;
  type: 'response.incomplete';
}

export interface OutputItemAddedEvent extends BaseStreamEvent {
  item: OutputItem;
  output_index: number;
  type: 'response.output_item.added';
}

export interface OutputItemDoneEvent extends BaseStreamEvent {
  item: OutputItem;
  output_index: number;
  type: 'response.output_item.done';
}

export interface ContentPartAddedEvent extends BaseStreamEvent {
  content_index: number;
  item_id: string;
  output_index: number;
  part: ContentPart;
  type: 'response.content_part.added';
}

export interface ContentPartDoneEvent extends BaseStreamEvent {
  content_index: number;
  item_id: string;
  output_index: number;
  part: ContentPart;
  type: 'response.content_part.done';
}

export interface OutputTextDeltaEvent extends BaseStreamEvent {
  content_index: number;
  delta: string;
  item_id: string;
  logprobs: any[];
  output_index: number;
  type: 'response.output_text.delta';
}

export interface OutputTextDoneEvent extends BaseStreamEvent {
  content_index: number;
  item_id: string;
  logprobs: any[];
  output_index: number;
  text: string;
  type: 'response.output_text.done';
}

export interface FunctionCallArgumentsDeltaEvent extends BaseStreamEvent {
  delta: string;
  item_id: string;
  output_index: number;
  type: 'response.function_call_arguments.delta';
}

export interface FunctionCallArgumentsDoneEvent extends BaseStreamEvent {
  arguments: string;
  item_id: string;
  output_index: number;
  type: 'response.function_call_arguments.done';
}

export interface ReasoningSummaryTextDeltaEvent extends BaseStreamEvent {
  delta: string;
  item_id: string;
  output_index: number;
  type: 'response.reasoning_summary_text.delta';
}

export interface ReasoningSummaryTextDoneEvent extends BaseStreamEvent {
  item_id: string;
  output_index: number;
  text: string;
  type: 'response.reasoning_summary_text.done';
}

export type ResponseStreamEvent =
  | ContentPartAddedEvent
  | ContentPartDoneEvent
  | FunctionCallArgumentsDeltaEvent
  | FunctionCallArgumentsDoneEvent
  | OutputItemAddedEvent
  | OutputItemDoneEvent
  | OutputTextDeltaEvent
  | OutputTextDoneEvent
  | ReasoningSummaryTextDeltaEvent
  | ReasoningSummaryTextDoneEvent
  | ResponseCompletedEvent
  | ResponseCreatedEvent
  | ResponseFailedEvent
  | ResponseInProgressEvent
  | ResponseIncompleteEvent;
