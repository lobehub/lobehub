import type { Debugger } from 'debug';
import type OpenAI from 'openai';

import type {
  ChatCompletionTool,
  GenerateObjectOptions,
  GenerateObjectPayload,
  GenerateObjectSchema,
} from '../../../types';
import type { OpenAICompatibleRuntimeContext } from '../../openaiCompatibleFactory/context';
import type {
  ChatCompletionCreateParamsWithPromptCacheKey,
  OpenAICompatibleFactoryOptions,
} from '../../openaiCompatibleFactory/factoryOptions';
import {
  parseStructuredOutputText,
  parseStructuredToolArguments,
  StructuredOutputError,
} from '../../openaiCompatibleFactory/structuredOutput';
import type { ChatPayloadForTransformStream } from '../../streams/protocol';
import { convertOpenAIUsage } from '../../usageConverters/openai';
import { convertOpenAIMessages } from './messages';

type Runtime = OpenAICompatibleRuntimeContext;
type Factory = OpenAICompatibleFactoryOptions;

type GenerateObjectReasoningParams = Pick<GenerateObjectPayload, 'reasoning_effort' | 'thinking'>;
export const getGenerateObjectReasoningParams = ({
  reasoning_effort,
  thinking,
}: GenerateObjectReasoningParams) =>
  reasoning_effort && thinking?.type !== 'disabled' ? { reasoning_effort } : {};

/**
 * Detect provider 400/422 errors that reject `response_format: { type: 'json_schema' }`.
 * Known message variants from the DeepSeek family (official API and gateways proxying it):
 * - `This response_format type is unavailable now`
 * - `response_format.type \`json_schema\` is unavailable now`
 */
export const isResponseFormatUnsupportedError = (error: unknown): boolean => {
  const err = error as { error?: { message?: unknown }; message?: unknown };
  const message = [err?.message, err?.error?.message]
    .filter((value): value is string => typeof value === 'string')
    .join('\n');
  if (!message) return false;

  return /(?:response_format|json_schema)[^]*?(?:unavailable|not +support)/i.test(message);
};

const convertGenerateObjectMessages = async (
  runtime: Runtime,
  factory: Factory,
  { messages, model }: GenerateObjectPayload,
) => {
  return convertOpenAIMessages(messages as any, {
    forceImageBase64: factory.chatCompletion?.forceImageBase64,
    forceVideoBase64: factory.chatCompletion?.forceVideoBase64,
    model,
    thoughtSignatureScope: await runtime.getSignatureScope(
      runtime.getMappedModelId(model),
      'thought_signature',
      'chat_completions',
    ),
  });
};

const handleGenerateObjectPayload = (
  runtime: Runtime,
  factory: Factory,
  payload: GenerateObjectPayload,
  requestPayload: ChatCompletionCreateParamsWithPromptCacheKey,
) => {
  return factory.generateObject?.handlePayload
    ? factory.generateObject.handlePayload(payload, requestPayload, runtime._options)
    : requestPayload;
};

/**
 * Simulate schema-based structured output through a forced tool call, for
 * providers that do not support `response_format: { type: 'json_schema' }`.
 * Returns the parsed schema object — the same shape as the json_schema path.
 */
export const generateObjectViaToolCalling = async (
  runtime: Runtime,
  factory: Factory,
  payload: GenerateObjectPayload,
  options: GenerateObjectOptions | undefined,
  usagePayload: ChatPayloadForTransformStream,
) => {
  const { schema, model } = payload;

  // Apply schema transformation if configured
  const processedSchema = factory.generateObject?.handleSchema
    ? { ...schema!, schema: factory.generateObject.handleSchema(schema!.schema) }
    : schema!;

  const tool: ChatCompletionTool = {
    function: {
      description:
        processedSchema.description ||
        'Generate structured output according to the provided schema',
      name: processedSchema.name || 'structured_output',
      parameters: processedSchema.schema,
    },
    type: 'function',
  };

  const res = await runtime.client.chat.completions.create(
    runtime.withMappedRequestModel(
      handleGenerateObjectPayload(runtime, factory, payload, {
        ...getGenerateObjectReasoningParams(payload),
        messages: await convertGenerateObjectMessages(runtime, factory, payload),
        model,
        ...runtime.resolvePromptCacheKeyParams(model, options?.user),
        tool_choice: { function: { name: tool.function.name }, type: 'function' },
        tools: [tool],
        user: options?.user,
      }),
      payload.model,
    ) as OpenAI.ChatCompletionCreateParamsNonStreaming,
    { headers: options?.headers, signal: options?.signal },
  );

  if (res.usage) {
    await options?.onUsage?.(convertOpenAIUsage(res.usage, usagePayload));
  }

  // Structural type keeps this compatible across openai SDK majors (v6
  // widened tool_calls to a function/custom union).
  const toolCalls = res.choices?.[0]?.message?.tool_calls as
    { function?: { arguments: string; name: string } }[] | undefined;
  const toolCall =
    toolCalls?.find((item) => item.function?.name === tool.function.name) ?? toolCalls?.[0];

  if (!toolCall?.function) throw new StructuredOutputError('no tool calls returned');

  return parseStructuredToolArguments(toolCall.function.arguments);
};

/** Structured output through `response_format: { type: 'json_schema' }`. */
export const generateObjectViaJsonSchema = async (
  runtime: Runtime,
  factory: Factory,
  payload: GenerateObjectPayload,
  processedSchema: GenerateObjectSchema,
  options: GenerateObjectOptions | undefined,
  usagePayload: ChatPayloadForTransformStream,
  log: Debugger,
) => {
  const { model } = payload;

  log('calling chat.completions.create for structured output');
  let res: OpenAI.ChatCompletion;
  try {
    res = await runtime.client.chat.completions.create(
      runtime.withMappedRequestModel(
        handleGenerateObjectPayload(runtime, factory, payload, {
          ...getGenerateObjectReasoningParams(payload),
          messages: await convertGenerateObjectMessages(runtime, factory, payload),
          model,
          response_format: { json_schema: processedSchema, type: 'json_schema' },
          ...runtime.resolvePromptCacheKeyParams(model, options?.user),
          user: options?.user,
        }),
        model,
      ) as OpenAI.ChatCompletionCreateParamsNonStreaming,
      { headers: options?.headers, signal: options?.signal },
    );
  } catch (error) {
    // Gateways can serve json_schema-incapable upstreams under arbitrary
    // model ids (e.g. OpenCode Zen's `big-pickle` proxies DeepSeek), which
    // the model-id detection above cannot catch. Retry once via forced
    // tool calling when the upstream rejects the response_format type.
    if (!isResponseFormatUnsupportedError(error)) throw error;

    log('provider rejected json_schema response_format, retrying via tool calling');
    return await generateObjectViaToolCalling(runtime, factory, payload, options, usagePayload);
  }
  if (res.usage) {
    await options?.onUsage?.(convertOpenAIUsage(res.usage, usagePayload));
  }

  const text = res.choices?.[0]?.message?.content;

  log('received structured output from Chat Completions API, length: %d', text?.length || 0);

  return parseStructuredOutputText(text);
};

/** Force the model to call one of `payload.tools` and return the parsed calls. */
export const generateToolCallsViaChatCompletions = async (
  runtime: Runtime,
  factory: Factory,
  payload: GenerateObjectPayload,
  options: GenerateObjectOptions | undefined,
  usagePayload: ChatPayloadForTransformStream | undefined,
  log: Debugger,
) => {
  const { model, tools } = payload;

  log('calling chat.completions.create for tool calling');
  const msgs = await convertGenerateObjectMessages(runtime, factory, payload);

  const res = await runtime.client.chat.completions.create(
    runtime.withMappedRequestModel(
      handleGenerateObjectPayload(runtime, factory, payload, {
        ...getGenerateObjectReasoningParams(payload),
        messages: msgs,
        model,
        ...runtime.resolvePromptCacheKeyParams(model, options?.user),
        tool_choice: 'required',
        tools,
        user: options?.user,
      }),
      payload.model,
    ) as OpenAI.ChatCompletionCreateParamsNonStreaming,
    { headers: options?.headers, signal: options?.signal },
  );

  if (res.usage) {
    await options?.onUsage?.(convertOpenAIUsage(res.usage, usagePayload));
  }

  const toolCalls = res.choices?.[0]?.message?.tool_calls;
  if (!toolCalls?.length) throw new StructuredOutputError('no tool calls returned');

  return toolCalls.map((item) => {
    if (!('function' in item) || !item.function) {
      throw new StructuredOutputError('function tool call required');
    }
    return {
      arguments: parseStructuredToolArguments(item.function.arguments),
      name: item.function.name,
    };
  });
};
