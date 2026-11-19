import { extractCompletionText, extractToolCalls } from './payload';

export interface ReplayCompletion {
  content: string;
  /** Set when the chat route streamed an `error` event instead of a completion. */
  error?: string;
  toolCalls: Array<{ arguments?: string; name: string }>;
  usage?: { completionTokens?: number; promptTokens?: number };
}

interface SSEEvent {
  data: string;
  event: string;
}

interface ToolCallDelta {
  function?: { arguments?: string; name?: string | null };
  id?: string;
  index?: number;
}

/**
 * Replay asks `/webapi/chat` for `stream: false`, but providers that force
 * streaming upstream (and the Responses API path) still answer with the
 * LobeHub SSE protocol (`id:` / `event:` / `data:` frames). Detect that by
 * content type — or by the body itself, since proxies may drop the header —
 * and fold the events into the same completion shape a JSON body yields.
 */
export const readReplayCompletion = async (res: Response): Promise<ReplayCompletion> => {
  const raw = await res.text();
  const contentType = res.headers.get('content-type') ?? '';

  if (contentType.includes('text/event-stream') || looksLikeSSE(raw)) {
    return aggregateSSECompletion(raw);
  }

  return fromJsonBody(JSON.parse(raw));
};

const looksLikeSSE = (raw: string) => /^(?:id|event|data):/.test(raw.trimStart());

const fromJsonBody = (body: unknown): ReplayCompletion => {
  const shaped = body as {
    output?: Array<{
      arguments?: string;
      content?: Array<{ text?: unknown; type?: string }>;
      name?: string;
      type?: string;
    }>;
    usage?: {
      completion_tokens?: number;
      input_tokens?: number;
      output_tokens?: number;
      prompt_tokens?: number;
    };
  };

  // Responses API body (`responseMode: 'json'` on the Responses path)
  if (Array.isArray(shaped?.output)) {
    return {
      content: shaped.output
        .filter((item) => item?.type === 'message')
        .flatMap((item) => item.content ?? [])
        .map((part) => (typeof part?.text === 'string' ? part.text : ''))
        .join(''),
      toolCalls: shaped.output
        .filter((item) => item?.type === 'function_call' && item.name)
        .map((item) => ({ arguments: item.arguments, name: item.name as string })),
      usage: {
        completionTokens: shaped.usage?.output_tokens,
        promptTokens: shaped.usage?.input_tokens,
      },
    };
  }

  return {
    content: extractCompletionText(body),
    toolCalls: extractToolCalls(body),
    usage: {
      completionTokens: shaped?.usage?.completion_tokens,
      promptTokens: shaped?.usage?.prompt_tokens,
    },
  };
};

const parseSSEEvents = (raw: string): SSEEvent[] =>
  raw
    .split(/\r?\n\r?\n/)
    .map((frame) => {
      let event = 'message';
      const data: string[] = [];
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      return { data: data.join('\n'), event };
    })
    .filter((event) => event.data);

const parseData = (data: string): unknown => {
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
};

/**
 * Fold LobeHub stream protocol events into one completion: `text` deltas and
 * text `content_part`s are concatenated, `tool_calls` deltas are merged per
 * call (by id, else index) with their argument fragments appended, and the
 * last `usage` wins.
 */
export const aggregateSSECompletion = (raw: string): ReplayCompletion => {
  let content = '';
  let error: string | undefined;
  let usage: ReplayCompletion['usage'];
  const calls: Array<{ arguments: string; id?: string; index?: number; name: string }> = [];

  for (const { data, event } of parseSSEEvents(raw)) {
    const value = parseData(data);

    switch (event) {
      case 'text': {
        if (typeof value === 'string') content += value;
        break;
      }

      // Multimodal streams (e.g. Gemini 3) carry answer text as content parts
      case 'content_part': {
        const part = value as { content?: unknown; inReasoning?: boolean; partType?: string };
        if (part?.partType === 'text' && !part.inReasoning && typeof part.content === 'string') {
          content += part.content;
        }
        break;
      }

      case 'tool_calls': {
        for (const delta of (Array.isArray(value) ? value : []) as ToolCallDelta[]) {
          const existing = calls.find((call) =>
            delta.id ? call.id === delta.id : call.index === delta.index,
          );
          if (existing) {
            existing.arguments += delta.function?.arguments ?? '';
            if (!existing.name && delta.function?.name) existing.name = delta.function.name;
          } else {
            calls.push({
              arguments: delta.function?.arguments ?? '',
              id: delta.id,
              index: delta.index,
              name: delta.function?.name ?? '',
            });
          }
        }
        break;
      }

      case 'usage': {
        const shaped = value as { totalInputTokens?: number; totalOutputTokens?: number };
        usage = {
          completionTokens: shaped?.totalOutputTokens,
          promptTokens: shaped?.totalInputTokens,
        };
        break;
      }

      case 'error': {
        const shaped = value as { message?: unknown; type?: unknown };
        error =
          typeof shaped?.message === 'string'
            ? shaped.message
            : typeof value === 'string'
              ? value
              : JSON.stringify(value);
        if (typeof shaped?.type === 'string') error = `${shaped.type}: ${error}`;
        break;
      }
    }
  }

  return {
    content,
    error,
    toolCalls: calls
      .filter((call) => call.name)
      .map((call) => ({ arguments: call.arguments, name: call.name })),
    usage,
  };
};
