import { INBOX_SESSION_ID, LOBE_CHAT_OBSERVATION_ID, LOBE_CHAT_TRACE_ID } from '@lobechat/const';
import { type ChatStreamCallbacks, type ChatStreamPayload } from '@lobechat/model-runtime';
import { type ModelUsage, type TracePayload } from '@lobechat/types';
import { TraceTagMap } from '@lobechat/types';

import { TraceClient } from '@/libs/traces';
import { after } from '@/server/utils/scheduleAfterResponse';

export interface AgentChatOptions {
  enableTrace?: boolean;
  provider: string;
  trace?: TracePayload;
}

type ModelParameters = Record<string, string | number>;

/**
 * Langfuse model parameters are flat strings and numbers. Objects such as `thinking` are sent as
 * JSON, and unset values are left out.
 */
const toModelParameters = (parameters: Record<string, unknown>): ModelParameters => {
  const result: ModelParameters = {};

  for (const [key, value] of Object.entries(parameters)) {
    if (value === undefined || value === null) continue;
    result[key] =
      typeof value === 'string' || typeof value === 'number' ? value : JSON.stringify(value);
  }

  return result;
};

const describeError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'errorType' in error) {
    return String((error as { errorType: unknown }).errorType);
  }
  return String(error);
};

/** Usage keys as Langfuse ingests them for OpenTelemetry generations. */
const toUsageDetails = (usage?: ModelUsage): Record<string, number> | undefined => {
  if (!usage) return;

  const details: Record<string, number | undefined> = {
    input: usage.totalInputTokens,
    output: usage.totalOutputTokens,
    total: usage.totalTokens,
  };

  return Object.fromEntries(
    Object.entries(details).filter((entry): entry is [string, number] => entry[1] !== undefined),
  );
};

export const createTraceOptions = (
  payload: ChatStreamPayload,
  { trace: tracePayload, provider }: AgentChatOptions,
) => {
  const { messages, model, tools, ...parameters } = payload;
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

  const generation = trace?.generation(`Chat Completion (${provider})`, {
    input: messages,
    metadata: { messageLength, model, provider },
    model,
    modelParameters: toModelParameters(parameters),
  });

  const headers = new Headers();

  const flushAfterResponse = () =>
    after(async () => {
      try {
        await traceClient.flush();
      } catch (e) {
        console.error('TraceClient flush error:', e);
      }
    });

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
          metadata: { grounding, thinking },
          output,
          usageDetails: toUsageDetails(usage),
        });

        trace?.update({ output });
      },

      onFinal: () => {
        // Spans are exported only once they end, including when the stream ended without a
        // completion.
        trace?.end();
        flushAfterResponse();
      },

      onStart: () => {
        generation?.update({ completionStartTime: new Date() });
      },

      onToolsCalling: async () => {
        trace?.setTags([...(tracePayload?.tags || []), TraceTagMap.ToolsCalling]);
      },
    } as ChatStreamCallbacks,
    /**
     * For a chat that fails before or instead of streaming, when no stream callback runs:
     * records the error on the generation, ends the observations and flushes them.
     */
    endOnError: (error: unknown) => {
      if (generation?.otelSpan.isRecording()) {
        generation.update({ level: 'ERROR', statusMessage: describeError(error) });
      }
      trace?.end();
      flushAfterResponse();
    },
    headers,
  };
};
