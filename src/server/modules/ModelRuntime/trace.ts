import { INBOX_SESSION_ID, LOBE_CHAT_OBSERVATION_ID, LOBE_CHAT_TRACE_ID } from '@lobechat/const';
import { type ChatStreamCallbacks, type ChatStreamPayload } from '@lobechat/model-runtime';
import { type TracePayload } from '@lobechat/types';
import { TraceTagMap } from '@lobechat/types';
import { after } from 'next/server';

import { getLangfuseConfig } from '@/envs/langfuse';
import { TraceClient } from '@/libs/traces';

export interface LangfuseTraceDataPayload {
  email?: string | null;
  userId?: string;
}

export interface AgentChatOptions {
  enableTrace?: boolean;
  provider: string;
  trace?: TracePayload;
  traceData?: LangfuseTraceDataPayload;
}

export const createTraceOptions = (
  payload: ChatStreamPayload,
  { trace: tracePayload, traceData, provider }: AgentChatOptions,
) => {
  const { messages, model, tools, ...parameters } = payload;
  // create a trace to monitor the completion
  const traceClient = new TraceClient();
  const { LANGFUSE_TRACE_DATA } = getLangfuseConfig();
  const messageLength = messages.length;
  const systemRole = messages.find((message) => message.role === 'system')?.content;

  const traceDataMap: Record<string, string | undefined | null> = {
    email: traceData?.email,
    userId: traceData?.userId ?? tracePayload?.userId,
  };

  const originalUserId = traceData?.userId ?? tracePayload?.userId;
  const traceUserId = traceDataMap[LANGFUSE_TRACE_DATA.userId] || originalUserId;

  const trace = traceClient.createTrace({
    id: tracePayload?.traceId,
    input: messages,
    metadata: { messageLength, model, provider, systemRole, tools },
    name: tracePayload?.traceName,
    sessionId: tracePayload?.topicId || `${tracePayload?.sessionId || INBOX_SESSION_ID}@default`,
    tags: tracePayload?.tags,
    userId: traceUserId,
  });

  const generation = trace?.generation({
    input: messages,
    metadata: { messageLength, model, provider },
    model,
    modelParameters: parameters as any,
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
