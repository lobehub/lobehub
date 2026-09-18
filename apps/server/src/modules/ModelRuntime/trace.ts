import { propagateAttributes, startObservation } from '@langfuse/tracing';
import { INBOX_SESSION_ID, LOBE_CHAT_OBSERVATION_ID, LOBE_CHAT_TRACE_ID } from '@lobechat/const';
import { type ChatStreamCallbacks, type ChatStreamPayload } from '@lobechat/model-runtime';
import { type TracePayload, TraceTagMap } from '@lobechat/types';
import { context, ROOT_CONTEXT, trace as otelTrace } from '@opentelemetry/api';

import { flushTraces, getLangfuseSpanProcessor, getTraceContext } from '@/libs/traces';
import { after } from '@/server/utils/scheduleAfterResponse';

export interface AgentChatOptions {
  enableTrace?: boolean;
  provider: string;
  signal?: AbortSignal;
  trace?: TracePayload;
}

export const createTraceOptions = async (
  payload: ChatStreamPayload,
  { trace: tracePayload, provider, signal }: AgentChatOptions,
) => {
  if (!tracePayload?.enabled || !getLangfuseSpanProcessor()) return;

  const { messages, model, tools, ...parameters } = payload;
  const messageLength = messages.length;
  const systemRole = messages.find((message) => message.role === 'system')?.content;
  const parentSpanContext = await getTraceContext(tracePayload.traceId);
  const attributes = {
    sessionId: tracePayload.topicId || `${tracePayload.sessionId || INBOX_SESSION_ID}@default`,
    tags: tracePayload.tags,
    traceName: tracePayload.traceName,
    userId: tracePayload.userId,
  };

  // Chat telemetry is independent of infrastructure spans and incoming sampling decisions.
  const { root, generation } = context.with(ROOT_CONTEXT, () =>
    propagateAttributes(attributes, () => {
      const root = startObservation(
        tracePayload.traceName || 'Chat Completion',
        {
          input: messages,
          metadata: { messageLength, model, provider, systemRole, tools },
        },
        { parentSpanContext },
      );
      const generation = root.startObservation(
        `Chat Completion (${provider})`,
        {
          input: messages,
          metadata: { messageLength, model, provider },
          model,
          modelParameters: parameters as Record<string, string | number>,
        },
        { asType: 'generation' },
      );
      return { generation, root };
    }),
  );

  let finished = false;
  let completionStarted = false;
  let partialText = '';
  let partialThinking = '';

  const markError = (error: unknown) => {
    const statusMessage = error instanceof Error ? error.message : JSON.stringify(error);
    root.update({ level: 'ERROR', statusMessage });
    generation.update({ level: 'ERROR', statusMessage });
  };

  const finish = (error?: unknown) => {
    if (finished) return;
    finished = true;
    signal?.removeEventListener('abort', onAbort);
    if (error) markError(error);
    generation.end();
    root.end();
    after(async () => {
      try {
        await flushTraces();
      } catch (error) {
        console.error('Langfuse flush error:', error);
      }
    });
  };

  const onAbort = () => {
    const output = partialThinking ? { text: partialText, thinking: partialThinking } : partialText;
    root.update({ level: 'WARNING', output, statusMessage: 'Chat request aborted' });
    generation.update({ level: 'WARNING', output, statusMessage: 'Chat request aborted' });
    finish();
  };

  const startCompletion = () => {
    if (finished || completionStarted) return;
    completionStarted = true;
    generation.update({ completionStartTime: new Date() });
  };

  const callback: ChatStreamCallbacks = {
    onError: (error) => {
      if (!finished) markError(error);
    },
    onFinal: ({ text, thinking, usage, grounding, toolsCalling, error }) => {
      if (finished) return;
      const output =
        toolsCalling && toolsCalling.length > 0
          ? text
            ? { text, thinking, toolsCalling }
            : toolsCalling
          : thinking
            ? { text, thinking }
            : text;

      generation.update({
        metadata: { grounding, thinking },
        output,
        usageDetails: usage
          ? {
              ...(usage.totalInputTokens !== undefined && { input: usage.totalInputTokens }),
              ...(usage.totalOutputTokens !== undefined && { output: usage.totalOutputTokens }),
              ...(usage.totalTokens !== undefined && { total: usage.totalTokens }),
            }
          : undefined,
      });
      root.update({ output });
      finish(error);
    },
    onText: (text) => {
      partialText += text;
      if (text) startCompletion();
    },
    onThinking: (thinking) => {
      partialThinking += thinking;
      if (thinking) startCompletion();
    },
    onToolsCalling: () => {
      if (finished) return;
      startCompletion();
      const tags = [...(tracePayload.tags || []), TraceTagMap.ToolsCalling];
      for (const observation of [root, generation]) {
        context.with(otelTrace.setSpan(ROOT_CONTEXT, observation.otelSpan), () =>
          propagateAttributes({ tags }, () => {}),
        );
      }
    },
  };

  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();

  return {
    callback,
    finish,
    headers: {
      [LOBE_CHAT_OBSERVATION_ID]: generation.id,
      [LOBE_CHAT_TRACE_ID]: root.traceId,
    },
  };
};
