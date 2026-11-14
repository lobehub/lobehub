import debug from 'debug';

import type { GenerateObjectOptions, GenerateObjectPayload } from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import { getModelPricing } from '../../utils/getModelPricing';
import { detectModelProvider } from '../../utils/modelParse';
import {
  generateObjectViaJsonSchema,
  generateObjectViaToolCalling,
  generateToolCallsViaChatCompletions,
} from '../protocols/openaiChatCompletions/generateObject';
import {
  generateObjectViaResponses,
  generateToolCallsViaResponses,
} from '../protocols/openaiResponses/generateObject';
import type { OpenAICompatibleRuntimeContext } from './context';
import { resolveErrorTypes } from './errors';
import type { OpenAICompatibleFactoryOptions } from './factoryOptions';
import { StructuredOutputError } from './structuredOutput';

type Runtime = OpenAICompatibleRuntimeContext;
type Factory = OpenAICompatibleFactoryOptions;

/** Factory-level Responses API routing control (supports instance override). */
const shouldUseResponsesForGenerateObject = (
  runtime: Runtime,
  factory: Factory,
  { model, responseApi }: GenerateObjectPayload,
  context: string,
) => {
  const instanceGenerateObject = ((runtime._options as any).generateObject || {}) as {
    useResponse?: boolean;
    useResponseModels?: Array<string | RegExp>;
  };
  const flagUseResponse =
    instanceGenerateObject.useResponse ??
    (factory.generateObject ? factory.generateObject.useResponse : undefined);
  const flagUseResponseModels =
    instanceGenerateObject.useResponseModels ?? factory.generateObject?.useResponseModels;

  return runtime.shouldUseResponsesAPI({
    context,
    flagUseResponse,
    flagUseResponseModels,
    model,
    responseApi,
  });
};

export const generateObject = async (
  runtime: Runtime,
  factory: Factory,
  payload: GenerateObjectPayload,
  options?: GenerateObjectOptions,
) => {
  const ErrorType = resolveErrorTypes(factory);
  try {
    const { schema, model, tools } = payload;

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
      log('generateObjectWithTools called with model: %s, toolsCount: %d', model, tools.length);

      return shouldUseResponsesForGenerateObject(runtime, factory, payload, 'tool calling')
        ? await generateToolCallsViaResponses(runtime, factory, payload, options, usagePayload, log)
        : await generateToolCallsViaChatCompletions(
            runtime,
            factory,
            payload,
            options,
            usagePayload,
            log,
          );
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

    const shouldUseResponses = shouldUseResponsesForGenerateObject(
      runtime,
      factory,
      payload,
      'generateObject',
    );

    // Apply schema transformation if configured
    const processedSchema = factory.generateObject?.handleSchema
      ? { ...schema, schema: factory.generateObject.handleSchema(schema.schema) }
      : schema;

    return shouldUseResponses
      ? await generateObjectViaResponses(
          runtime,
          factory,
          payload,
          processedSchema,
          options,
          usagePayload,
          log,
        )
      : await generateObjectViaJsonSchema(
          runtime,
          factory,
          payload,
          processedSchema,
          options,
          usagePayload,
          log,
        );
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
