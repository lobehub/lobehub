import type { Debugger } from 'debug';
import type OpenAI from 'openai';

import {
  isGPTProResponsesModel,
  supportsGPTResponsesReasoningEffortNone,
} from '../../../providers/openai/modelId';
import type {
  GenerateObjectOptions,
  GenerateObjectPayload,
  GenerateObjectSchema,
} from '../../../types';
import type { OpenAICompatibleRuntimeContext } from '../../openaiCompatibleFactory/context';
import type { OpenAICompatibleFactoryOptions } from '../../openaiCompatibleFactory/factoryOptions';
import {
  parseStructuredOutputText,
  parseStructuredToolArguments,
  StructuredOutputError,
} from '../../openaiCompatibleFactory/structuredOutput';
import type { ChatPayloadForTransformStream } from '../../streams/protocol';
import { convertOpenAIResponseUsage } from '../../usageConverters/openai';
import { convertOpenAIResponseInputs } from './inputs';
import { convertChatCompletionToolToResponseTool } from './tools';

type Runtime = OpenAICompatibleRuntimeContext;
type Factory = OpenAICompatibleFactoryOptions;

type GenerateObjectReasoningParams = Pick<GenerateObjectPayload, 'reasoning_effort' | 'thinking'>;
export const getGenerateObjectResponsesReasoningParams = ({
  model,
  reasoning_effort,
  thinking,
}: GenerateObjectReasoningParams & { model: string }) => {
  if (isGPTProResponsesModel(model)) {
    return reasoning_effort && reasoning_effort !== 'max' ? { reasoning: { effort: 'high' } } : {};
  }

  if (thinking?.type === 'disabled') {
    return supportsGPTResponsesReasoningEffortNone(model) ? { reasoning: { effort: 'none' } } : {};
  }

  return reasoning_effort && reasoning_effort !== 'max'
    ? { reasoning: { effort: reasoning_effort } }
    : {};
};

/** Structured output through `text.format: { type: 'json_schema' }`. */
export const generateObjectViaResponses = async (
  runtime: Runtime,
  factory: Factory,
  payload: GenerateObjectPayload,
  processedSchema: GenerateObjectSchema,
  options: GenerateObjectOptions | undefined,
  usagePayload: ChatPayloadForTransformStream,
  log: Debugger,
) => {
  const { messages, model } = payload;

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
};

/** Force the model to call one of `payload.tools` and return the parsed calls. */
export const generateToolCallsViaResponses = async (
  runtime: Runtime,
  factory: Factory,
  payload: GenerateObjectPayload,
  options: GenerateObjectOptions | undefined,
  usagePayload: ChatPayloadForTransformStream | undefined,
  log: Debugger,
) => {
  const { messages, model, tools } = payload;

  log('calling responses.create for tool calling');
  const reasoningSignatureScope = await runtime.getSignatureScope(
    runtime.getMappedModelId(payload.model),
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
};
