import { INBOX_SESSION_ID, LOBE_CHAT_OBSERVATION_ID, LOBE_CHAT_TRACE_ID } from '@lobechat/const';
import { type ChatStreamCallbacks, type ChatStreamPayload } from '@lobechat/model-runtime';
import { type TracePayload } from '@lobechat/types';
import { TraceTagMap } from '@lobechat/types';
import type { CreateLangfuseGenerationBody } from 'langfuse-core';
import { after } from 'next/server';

import { TraceClient } from '@/libs/traces';

export interface AgentChatOptions {
  enableTrace?: boolean;
  provider: string;
  trace?: TracePayload;
}

type TraceModelParameters = NonNullable<CreateLangfuseGenerationBody['modelParameters']>;
type TraceModelParameterValue = TraceModelParameters[string];

// Langfuse modelParameters only accepts primitives and string arrays.
// Keep structured runtime params observable by serializing them instead of dropping them.
const serializeTraceModelParameter = (value: unknown): TraceModelParameterValue | undefined => {
  if (value === undefined || value === null) return;

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => {
      const serializedItem = serializeTraceModelParameter(item);

      // Langfuse arrays are typed as string arrays, so nested values need a stable string form.
      if (Array.isArray(serializedItem)) return JSON.stringify(serializedItem);

      return String(serializedItem);
    });
  }

  if (typeof value === 'bigint') return value.toString();

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const sanitizeTraceModelParameters = (parameters: Record<string, unknown>) => {
  const sanitizedParameters: Record<string, TraceModelParameterValue> = {};

  for (const [key, value] of Object.entries(parameters)) {
    const serializedValue = serializeTraceModelParameter(value);

    if (serializedValue !== undefined) {
      sanitizedParameters[key] = serializedValue;
    }
  }

  return sanitizedParameters;
};

export const createTraceOptions = (
  payload: ChatStreamPayload,
  { trace: tracePayload, provider }: AgentChatOptions,
) => {
  const { messages, model, tools, ...parameters } = payload;
  const modelParameters = sanitizeTraceModelParameters(parameters);

  // create a trace to monitor the completion
  const traceClient = new TraceClient();
  const messageLength = messages.length;
  const systemRole = messages.find((message) => message.role === 'system')?.content;

  const trace = traceClient.createTrace({
    id: tracePayload?.traceId,
    input: messages,
    metadata: { messageLength, model, provider, systemRole, tools },
    name: tracePayload?.traceName,
    sessionId: tracePayload?.topicId
      ? tracePayload.topicId
      : `${tracePayload?.sessionId || INBOX_SESSION_ID}@default`,
    tags: tracePayload?.tags,
    userId: tracePayload?.userId,
  });

  const generation = trace?.generation({
    input: messages,
    metadata: { messageLength, model, provider },
    model,
    modelParameters,
    name: `Chat Completion (${provider})`,
    startTime: new Date(),
  });

  const headers = new Headers();

  if (trace?.id) {
    headers.set(LOBE_CHAT_TRACE_ID, trace.id);
  }

  if (generation?.id) {
    headers.set(LOBE_CHAT_OBSERVATION_ID, generation.id);
  }

  return {
    callback: {
      onCompletion: async ({ text, thinking, usage, grounding, toolsCalling }) => {
        const output =
          // if the toolsCalling is not empty, we need to return the toolsCalling
          !!toolsCalling && toolsCalling.length > 0
            ? !!text
              ? // tools calling with thinking and text
                { text, thinking, toolsCalling }
              : toolsCalling
            : !!thinking
              ? { text, thinking }
              : text;

        generation?.update({
          endTime: new Date(),
          metadata: { grounding, thinking },
          output,
          usage: usage
            ? {
                completionTokens: usage.outputTextTokens,
                input: usage.totalInputTokens,
                output: usage.totalOutputTokens,
                promptTokens: usage.inputTextTokens,
                totalTokens: usage.totalTokens,
              }
            : undefined,
        });

        trace?.update({ output });
      },

      onFinal: () => {
        after(async () => {
          try {
            await traceClient.shutdownAsync();
          } catch (e) {
            console.error('TraceClient shutdown error:', e);
          }
        });
      },

      onStart: () => {
        generation?.update({ completionStartTime: new Date() });
      },

      onToolsCalling: async () => {
        trace?.update({
          tags: [...(tracePayload?.tags || []), TraceTagMap.ToolsCalling],
        });
      },
    } as ChatStreamCallbacks,
    headers,
  };
};
