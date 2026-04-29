import { ModelProvider } from 'model-bank';
import OpenAI from 'openai';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export const TOWERAI_DEFAULT_BASE_URL = 'https://tower-ai.yottastudios.com';

export function resolveTowerAIEndpoint(baseUrl: string, model: string): string {
  const base = baseUrl.replace(/\/$/, '');
  if (model.startsWith('gemini') || model.startsWith('claude')) {
    return `${base}/zi/webapi/chat/vertexai`;
  }
  if (model.startsWith('deepseek')) {
    return `${base}/zi/webapi/chat/newapi`;
  }
  return `${base}/zi/webapi/chat/openai`;
}

// Convert Tower AI SSE (event: text/stop) → OpenAI SSE (data: {...})
function toOpenAIStream(
  src: ReadableStream<Uint8Array>,
  model: string,
): ReadableStream<Uint8Array> {
  const reader = src.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const id = `chatcmpl-towerai-${Date.now()}`;
  let buf = '';
  let closed = false;
  let hadToolCalls = false;

  function emitChunk(
    ctrl: ReadableStreamDefaultController<Uint8Array>,
    content: string,
    finishReason: string | null,
  ) {
    const chunk = {
      id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finishReason }],
    };
    ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
  }

  // Returns true if the stream should be closed
  function processEvent(raw: string, ctrl: ReadableStreamDefaultController<Uint8Array>): boolean {
    const lines = raw.trim().split('\n');
    let eventType = '';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) eventType = line.slice(7).trim();
      else if (line.startsWith('data: ')) data = line.slice(6);
    }

    if (eventType === 'tool_calls' && data) {
      let toolCalls: any[];
      try {
        toolCalls = JSON.parse(data);
      } catch {
        return false;
      }
      const chunk = {
        id,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ delta: { tool_calls: toolCalls }, finish_reason: null, index: 0 }],
      };
      ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      hadToolCalls = true;
      return false;
    }

    if (eventType === 'text' && data) {
      let content: string;
      try {
        content = JSON.parse(data);
      } catch {
        content = data;
      }
      emitChunk(ctrl, content, null);
    } else if (eventType === 'stop') {
      emitChunk(ctrl, '', hadToolCalls ? 'tool_calls' : 'stop');
      ctrl.enqueue(encoder.encode('data: [DONE]\n\n'));
      ctrl.close();
      return true;
    }
    return false;
  }

  return new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      if (closed) return;
      const { done, value } = await reader.read();
      if (done) {
        if (buf.trim()) processEvent(buf, ctrl);
        if (!closed) ctrl.close();
        return;
      }
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      for (const part of parts) {
        if (part.trim() && processEvent(part, ctrl)) {
          closed = true;
          return;
        }
      }
    },
  });
}

// Vertexai-endpoint models that support native function calling.
// Corresponds to abilities.functionCall: true in the towerai model bank.
// When tools are present for these models, pass them through directly instead of
// converting to Tower AI's built-in search mode.
const VERTEXAI_FUNCTION_CALL_MODELS = new Set([
  'gemini-3-flash-preview',
  'gemini-3.1-pro-preview',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5-20250929',
]);

// JSON Schema fields that Vertex AI does not support in function declarations.
// Vertex AI uses a restricted subset of JSON Schema — passing unsupported fields
// results in a 400 INVALID_ARGUMENT / 471 error from the backend.
const VERTEXAI_UNSUPPORTED_SCHEMA_KEYS = new Set([
  'const',
  '$schema',
  '$id',
  '$ref',
  'definitions',
  '$defs',
  'examples',
  'default',
]);

function sanitizeSchemaForVertexAI(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sanitizeSchemaForVertexAI);

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (VERTEXAI_UNSUPPORTED_SCHEMA_KEYS.has(k)) continue;
    result[k] = sanitizeSchemaForVertexAI(v);
  }
  return result;
}

function sanitizeToolsForVertexAI(tools: unknown[]): unknown[] {
  return tools.map((tool) => {
    if (!tool || typeof tool !== 'object') return tool;
    const t = tool as any;
    if (!t.function?.parameters) return tool;
    return {
      ...t,
      function: { ...t.function, parameters: sanitizeSchemaForVertexAI(t.function.parameters) },
    };
  });
}

export const params = {
  baseURL: `${TOWERAI_DEFAULT_BASE_URL}/zi/webapi/chat/openai`,
  chatCompletion: {
    handlePayload: (payload) => {
      // Strip OpenAI-style fields Tower AI doesn't support
      const { stream_options, user, tools, tool_choice, ...rest } = payload as any;
      void stream_options;
      void user;

      const model = (rest.model as string) ?? '';
      const isVertexai = model.startsWith('gemini') || model.startsWith('claude');
      const hasTools = Array.isArray(tools) && tools.length > 0;

      // For vertexai models with native function calling support, pass tools through.
      // Tower AI's vertexai endpoint returns tool calls as `event: tool_calls` SSE events,
      // which toOpenAIStream converts to OpenAI format.
      if (hasTools && VERTEXAI_FUNCTION_CALL_MODELS.has(model)) {
        return {
          ...rest,
          stream: true,
          tool_choice,
          tools: sanitizeToolsForVertexAI(tools),
        } as any;
      }

      // Tower AI uses its own search params instead of function calling.
      // When LobeHub sends tools (e.g. web search), translate to Tower AI's native search API.
      const searchParams = hasTools
        ? isVertexai
          ? { searchMode: 'smart', useModelBuiltinSearch: true }
          : { enabledSearch: true }
        : {};

      // Vertexai endpoint always needs SSE; OpenAI endpoint also needs SSE when search is enabled
      const useStream = isVertexai || hasTools;
      return { ...rest, stream: useStream, ...searchParams } as any;
    },
  },
  customClient: {
    createClient: (options) => {
      const token = process.env.TOWERAI_API_KEY || options.apiKey || '';
      const authToken = process.env.TOWERAI_AUTH_TOKEN || '';
      const debug = process.env.DEBUG_TOWERAI_CHAT_COMPLETION === '1';

      const customFetch: typeof fetch = async (input, init) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : (input as Request).url;

        if (!url.includes('/chat/completions')) return fetch(input, init);

        const body = init?.body ? JSON.parse(init.body as string) : {};
        const model = (body?.model as string) || '';
        const isStreaming = (body?.stream as boolean) ?? false;
        const endpoint = resolveTowerAIEndpoint(TOWERAI_DEFAULT_BASE_URL, model);

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'accept': isStreaming ? 'text/event-stream' : 'application/json',
          'Token': token,
        };
        if (authToken) headers['X-lobe-chat-auth'] = authToken;

        if (debug) {
          console.info('[TowerAI] → POST', endpoint, 'model:', model);
          console.info(
            '[TowerAI]   Token:',
            token.slice(0, 12),
            '...  X-lobe-chat-auth:',
            authToken ? authToken.slice(0, 12) + '...' : '(none)',
          );
        }

        const res = await fetch(endpoint, { method: 'POST', headers, body: init?.body as string });

        if (debug) {
          const preview = await res.clone().text();
          console.info('[TowerAI] ←', res.status, res.headers.get('content-type'));
          console.info('[TowerAI]  ', preview.slice(0, 300));
        }

        if (!res.ok || !res.body) return res;

        const ct = res.headers.get('content-type') ?? '';
        if (!ct.includes('text/event-stream') && !ct.includes('text/plain')) {
          return res; // already JSON, pass through
        }

        // Tower AI sometimes returns HTTP 200 with a JSON error body (e.g. {"error_code":502,...}).
        // Peek at the body; if it's JSON (starts with '{'), surface it as a 502 error.
        if (isStreaming) {
          const cloned = res.clone();
          const peek = await cloned.text();
          if (peek.trimStart().startsWith('{')) {
            return new Response(peek, {
              status: 502,
              headers: { 'content-type': 'application/json' },
            });
          }
        }

        return new Response(toOpenAIStream(res.body, model), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      };

      return new OpenAI({
        ...options,
        apiKey: token || 'tower-ai',
        baseURL: `${TOWERAI_DEFAULT_BASE_URL}/zi/webapi/chat/openai`,
        defaultHeaders: {},
        fetch: customFetch,
      });
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_TOWERAI_CHAT_COMPLETION === '1',
  },
  errorType: {
    bizError: 'TowerAIBizError',
    invalidAPIKey: 'InvalidTowerAIAPIKey',
  },
  provider: ModelProvider.TowerAI,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeTowerAI = createOpenAICompatibleRuntime(params);
