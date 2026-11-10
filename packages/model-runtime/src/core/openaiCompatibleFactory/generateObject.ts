import debug from 'debug';
import type OpenAI from 'openai';

import type { ChatCompletionTool, GenerateObjectOptions, GenerateObjectPayload } from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import { getModelPricing } from '../../utils/getModelPricing';
import { detectModelProvider } from '../../utils/modelParse';
import { convertOpenAIMessages } from '../protocols/openaiChatCompletions/messages';
import { convertOpenAIResponseInputs } from '../protocols/openaiResponses/inputs';
import { convertChatCompletionToolToResponseTool } from '../protocols/openaiResponses/tools';
import type { ChatPayloadForTransformStream } from '../streams/protocol';
import { convertOpenAIResponseUsage, convertOpenAIUsage } from '../usageConverters/openai';
import type { OpenAICompatibleRuntimeContext } from './context';
import { resolveErrorTypes } from './errors';
import type {
  ChatCompletionCreateParamsWithPromptCacheKey,
  OpenAICompatibleFactoryOptions,
} from './factoryOptions';
import {
  getGenerateObjectReasoningParams,
  getGenerateObjectResponsesReasoningParams,
} from './generateObjectReasoning';
import {
  parseStructuredOutputText,
  parseStructuredToolArguments,
  StructuredOutputError,
} from './structuredOutput';

type Runtime = OpenAICompatibleRuntimeContext;
type Factory = OpenAICompatibleFactoryOptions;

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

export const convertGenerateObjectMessages = async (
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
const generateObjectViaToolCalling = async (
  runtime: Runtime,
  factory: Factory,
  payload: GenerateObjectPayload,
  options: GenerateObjectOptions | undefined,
  usagePayload: Parameters<typeof convertOpenAIUsage>[1],
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

export const generateObject = async (
  runtime: Runtime,
  factory: Factory,
  payload: GenerateObjectPayload,
  options?: GenerateObjectOptions,
) => {
  const ErrorType = resolveErrorTypes(factory);
  try {
    const { messages, schema, model, responseApi, tools } = payload;

    const log = debug(`${runtime.logPrefix}:generateObject`);
    log(
      'generateObject called with model: %s, hasTools: %s, hasSchema: %s',
      model,
      !!tools,
      !!schema,
    );

    const pricing = await getModelPricing(model, runtime.id, options?.pricingContext);
    const usagePayload = { model, pricing, provider: runtime.id };

    if (tools) {
      log('using tools-based generation');
      return await generateObjectWithTools(runtime, factory, payload, options, usagePayload);
    }

    if (!schema) throw new Error('tools or schema is required');

    // Use tool calling fallback if configured, or when the model is known to
    // reject `response_format: { type: 'json_schema' }`. The DeepSeek API only
    // supports `json_object` and replies `400 This response_format type is
    // unavailable now` to json_schema requests, so DeepSeek-family models served
    // through generic OpenAI-compatible providers (aggregator gateways, custom
    // endpoints) must simulate structured output via forced tool calling.
    if (factory.generateObject?.useToolsCalling || detectModelProvider(model) === 'deepseek') {
      log('using tool calling fallback for structured output');
      return await generateObjectViaToolCalling(runtime, factory, payload, options, usagePayload);
    }

    // Factory-level Responses API routing control (supports instance override)
    const instanceGenerateObject = ((runtime._options as any).generateObject || {}) as {
      useResponse?: boolean;
      useResponseModels?: Array<string | RegExp>;
    };
    const flagUseResponse =
      instanceGenerateObject.useResponse ??
      (factory.generateObject ? factory.generateObject.useResponse : undefined);
    const flagUseResponseModels =
      instanceGenerateObject.useResponseModels ?? factory.generateObject?.useResponseModels;

    const shouldUseResponses = runtime.shouldUseResponsesAPI({
      context: 'generateObject',
      flagUseResponse,
      flagUseResponseModels,
      model,
      responseApi,
    });

    // Apply schema transformation if configured
    const processedSchema = factory.generateObject?.handleSchema
      ? { ...schema, schema: factory.generateObject.handleSchema(schema.schema) }
      : schema;

    if (shouldUseResponses) {
      log('calling responses.create for structured output');
      // Chat Completions content parts are not valid Responses input: a `text` part must
      // become `input_text` and an `image_url` part `input_image`, or the API rejects the
      // whole request. String content survives untouched, which is why text-only callers
      // never hit this.
      const input = await convertOpenAIResponseInputs(messages as any, {
        forceImageBase64: factory.chatCompletion?.forceImageBase64,
        forceVideoBase64: factory.chatCompletion?.forceVideoBase64,
        provider: runtime.id,
        strictToolPairing: true,
      });
      const preparedRequest = runtime.prepareResponsesRequest(
        {
          input,
          model,
          ...getGenerateObjectResponsesReasoningParams(payload),
          ...runtime.resolvePromptCacheKeyParams(model, options?.user),
          text: { format: { strict: true, type: 'json_schema', ...processedSchema } },
          // Responses API replaced `user` with `safety_identifier`; some endpoints reject `user`
          safety_identifier: options?.user,
        } as any,
        model,
      );
      const res = await runtime.client!.responses.create(
        preparedRequest.payload as OpenAI.Responses.ResponseCreateParamsNonStreaming,
        {
          headers: preparedRequest.headers
            ? { ...options?.headers, ...preparedRequest.headers }
            : options?.headers,
          signal: options?.signal,
        },
      );

      if (res.usage) {
        await options?.onUsage?.(convertOpenAIResponseUsage(res.usage, usagePayload));
      }

      const text = res.output_text;
      log('received structured output from Responses API, length: %d', text?.length || 0);
      return parseStructuredOutputText(text);
    }

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
  } catch (error) {
    // Provider HTTP normalization must not hide the structured-output recovery signal.
    if (error instanceof StructuredOutputError) throw error;

    const handledError = runtime.handleError(error);

    if (
      handledError.errorType === AgentRuntimeErrorType.AgentRuntimeError ||
      handledError.errorType === ErrorType.bizError
    ) {
      throw error;
    }

    throw handledError;
  }
};

const generateObjectWithTools = async (
  runtime: Runtime,
  factory: Factory,
  payload: GenerateObjectPayload,
  options?: GenerateObjectOptions,
  usagePayload?: ChatPayloadForTransformStream,
) => {
  const { messages, model, tools, responseApi } = payload;
  const log = debug(`${runtime.logPrefix}:generateObject`);

  log('generateObjectWithTools called with model: %s, toolsCount: %d', model, tools?.length || 0);

  // Factory-level Responses API routing control (supports instance override)
  const instanceGenerateObject = ((runtime._options as any).generateObject || {}) as {
    useResponse?: boolean;
    useResponseModels?: Array<string | RegExp>;
  };
  const flagUseResponse =
    instanceGenerateObject.useResponse ??
    (factory.generateObject ? factory.generateObject.useResponse : undefined);
  const flagUseResponseModels =
    instanceGenerateObject.useResponseModels ?? factory.generateObject?.useResponseModels;

  const shouldUseResponses = runtime.shouldUseResponsesAPI({
    context: 'tool calling',
    flagUseResponse,
    flagUseResponseModels,
    model,
    responseApi,
  });
  const requestModel = runtime.getMappedModelId(payload.model);

  if (shouldUseResponses) {
    log('calling responses.create for tool calling');
    const reasoningSignatureScope = await runtime.getSignatureScope(
      requestModel,
      'reasoning',
      'responses',
    );
    const input = await convertOpenAIResponseInputs(messages as any, {
      forceImageBase64: factory.chatCompletion?.forceImageBase64,
      forceVideoBase64: factory.chatCompletion?.forceVideoBase64,
      provider: runtime.id,
      reasoningSignatureScope,
      strictToolPairing: true,
    });

    const preparedRequest = runtime.prepareResponsesRequest(
      {
        input,
        model,
        ...runtime.resolvePromptCacheKeyParams(model, options?.user),
        tool_choice: 'required',
        tools: tools!.map(convertChatCompletionToolToResponseTool),
        // Responses API replaced `user` with `safety_identifier`; some endpoints reject `user`
        safety_identifier: options?.user,
      } as any,
      payload.model,
    );
    const res = await runtime.client.responses.create(
      preparedRequest.payload as OpenAI.Responses.ResponseCreateParamsNonStreaming,
      {
        headers: preparedRequest.headers
          ? { ...options?.headers, ...preparedRequest.headers }
          : options?.headers,
        signal: options?.signal,
      },
    );

    if (res.usage) {
      await options?.onUsage?.(convertOpenAIResponseUsage(res.usage, usagePayload));
    }

    const functionCalls = res.output?.filter((item) => item.type === 'function_call');

    log('received %d function calls from Responses API', functionCalls?.length || 0);

    if (!functionCalls?.length) throw new StructuredOutputError('no tool calls returned');
    return functionCalls.map((item) => ({
      arguments: parseStructuredToolArguments(item.arguments),
      name: item.name,
    }));
  }

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
