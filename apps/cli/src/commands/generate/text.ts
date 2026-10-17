import type { Command } from 'commander';

import { getAuthInfo } from '../../api/http';
import { CLI_PRIMARY_BIN } from '../../constants/identity';
import { log } from '../../utils/logger';

export function registerTextCommand(parent: Command) {
  parent
    .command('text <prompt>')
    .description('Generate text with an LLM (single completion, no tools)')
    .option('-m, --model <model>', 'Model ID (provider/model format)', 'openai/gpt-4o-mini')
    .option('-p, --provider <provider>', 'Provider name (derived from model if omitted)')
    .option('-s, --system <prompt>', 'System prompt')
    .option('--temperature <n>', 'Temperature (0-2)')
    .option('--max-tokens <n>', 'Maximum output tokens')
    .option('--stream', 'Enable streaming (SSE, renders incrementally)')
    .option('--json', 'Output full JSON response')
    .option('--pipe', 'Pipe mode: read additional context from stdin')
    .action(
      async (
        prompt: string,
        options: {
          json?: boolean;
          maxTokens?: string;
          model: string;
          pipe?: boolean;
          provider?: string;
          stream?: boolean;
          system?: string;
          temperature?: string;
        },
      ) => {
        // Resolve provider from model if not specified
        const parts = options.model.split('/');
        const provider = options.provider || (parts.length > 1 ? parts[0] : 'openai');
        const model = parts.length > 1 ? parts.slice(1).join('/') : options.model;

        // Read additional input from stdin if --pipe
        let fullPrompt = prompt;
        if (options.pipe) {
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) {
            chunks.push(chunk as Buffer);
          }
          const stdinContent = Buffer.concat(chunks).toString('utf8').trim();
          if (stdinContent) {
            fullPrompt = `${prompt}\n\n${stdinContent}`;
          }
        }

        const messages: Array<{ content: string; role: string }> = [];
        if (options.system) {
          messages.push({ content: options.system, role: 'system' });
        }
        messages.push({ content: fullPrompt, role: 'user' });

        const useStream = options.stream === true;

        const payload: Record<string, any> = {
          messages,
          model,
          // Ask for a plain JSON body when not streaming; runtimes that ignore
          // responseMode still reply with SSE, handled below
          responseMode: useStream ? 'stream' : 'json',
          stream: useStream,
        };
        if (options.temperature) payload.temperature = Number.parseFloat(options.temperature);
        if (options.maxTokens) payload.max_tokens = Number.parseInt(options.maxTokens, 10);

        const { serverUrl, headers } = await getAuthInfo();

        const res = await fetch(`${serverUrl}/webapi/chat/${provider}`, {
          body: JSON.stringify(payload),
          headers,
          method: 'POST',
        });

        if (!res.ok) {
          const text = await res.text();
          log.error(`Text generation failed: ${res.status} ${text}`);
          process.exit(1);
          return;
        }

        // `/webapi/chat/*` answers with LobeHub's SSE protocol even for `stream: false`
        // on most providers (`responseMode: 'json'` is only honored by some runtimes),
        // so only treat the body as plain JSON when the server says it is.
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const body = await res.json();
          if (options.json) {
            console.log(JSON.stringify(body, null, 2));
          } else {
            // Support both OpenAI format (choices[].message.content) and
            // Anthropic format (content[].text)
            const content =
              (body as any).choices?.[0]?.message?.content ||
              (body as any).content?.[0]?.text ||
              JSON.stringify(body);
            process.stdout.write(content);
            process.stdout.write('\n');
          }
          return;
        }

        if (!res.body) {
          log.error('No response body received');
          process.exit(1);
          return;
        }

        if (useStream) {
          await streamSSEResponse(res.body, options.json);
        } else {
          await collectSSEResponse(res.body, options.json);
        }
      },
    );
}

interface SSEEvent {
  data: any;
  /** SSE `event:` field; `undefined` for plain OpenAI-style streams */
  event?: string;
}

/**
 * Parse an SSE body into events. LobeHub's chat protocol tags every event with
 * `event: <type>` (`text`, `content_part`, `reasoning`, `stop`, `usage`, `error`, ...),
 * and the meaning of `data` depends on that type.
 */
async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<SSEEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event: string | undefined;
  let dataLines: string[] = [];

  const flush = (): SSEEvent | undefined => {
    if (dataLines.length === 0) {
      event = undefined;
      return;
    }
    const raw = dataLines.join('\n');
    const current = event;
    event = undefined;
    dataLines = [];

    try {
      return { data: JSON.parse(raw), event: current };
    } catch {
      return { data: raw, event: current };
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = done ? '' : lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        if (line === '') {
          const parsed = flush();
          if (parsed) yield parsed;
        } else if (line.startsWith('event:')) {
          event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }

      if (done) {
        const parsed = flush();
        if (parsed) yield parsed;
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

type SSEPayload =
  | { kind: 'done' }
  | { kind: 'error'; data: unknown }
  | { kind: 'image' }
  | { kind: 'reasoning'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'other' };

function classifySSEEvent({ data, event }: SSEEvent): SSEPayload {
  if (data === '[DONE]') return { kind: 'done' };

  switch (event) {
    case 'text': {
      return typeof data === 'string' ? { kind: 'text', text: data } : { kind: 'other' };
    }
    case 'reasoning': {
      return typeof data === 'string' ? { kind: 'reasoning', text: data } : { kind: 'other' };
    }
    // Gemini emits multimodal parts instead of `text` / `reasoning` events:
    // reply parts as `content_part`, thought parts as `reasoning_part`
    case 'content_part': {
      if (data?.partType === 'image') return { kind: 'image' };
      if (data?.partType !== 'text' || typeof data.content !== 'string') return { kind: 'other' };
      return { kind: 'text', text: data.content };
    }
    case 'reasoning_part': {
      if (data?.partType !== 'text' || typeof data.content !== 'string') return { kind: 'other' };
      return { kind: 'reasoning', text: data.content };
    }
    case 'base64_image': {
      return { kind: 'image' };
    }
    case 'error': {
      return { data, kind: 'error' };
    }
    case undefined: {
      // Plain OpenAI chat-completion chunks without `event:` tags
      const content = data?.choices?.[0]?.delta?.content;
      return typeof content === 'string' ? { kind: 'text', text: content } : { kind: 'other' };
    }
    default: {
      return { kind: 'other' };
    }
  }
}

/** Image models answer with image parts only, which would otherwise print nothing */
function warnImageOnlyReply(imageCount: number): void {
  log.warn(
    `The model returned ${imageCount} image(s) and no text. Use \`${CLI_PRIMARY_BIN} generate image\` for image models.`,
  );
}

function reportSSEError(data: unknown): void {
  log.error(`Text generation failed: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  process.exit(1);
}

async function streamSSEResponse(body: ReadableStream<Uint8Array>, json?: boolean): Promise<void> {
  let hasText = false;
  let imageCount = 0;

  for await (const event of parseSSE(body)) {
    const payload = classifySSEEvent(event);
    if (payload.kind === 'done') break;

    if (json) {
      console.log(JSON.stringify(event));
      if (payload.kind === 'error') process.exit(1);
      continue;
    }

    if (payload.kind === 'error') {
      process.stdout.write('\n');
      reportSSEError(payload.data);
      return;
    }
    if (payload.kind === 'text') {
      hasText = true;
      process.stdout.write(payload.text);
    } else if (payload.kind === 'image') imageCount++;
  }

  if (json) return;
  process.stdout.write('\n');
  if (!hasText && imageCount > 0) warnImageOnlyReply(imageCount);
}

async function collectSSEResponse(body: ReadableStream<Uint8Array>, json?: boolean): Promise<void> {
  let content = '';
  let reasoning = '';
  let finishReason: unknown;
  let imageCount = 0;
  let usage: unknown;

  for await (const event of parseSSE(body)) {
    const payload = classifySSEEvent(event);
    if (payload.kind === 'done') break;

    if (payload.kind === 'error') {
      reportSSEError(payload.data);
      return;
    }
    if (payload.kind === 'text') content += payload.text;
    else if (payload.kind === 'reasoning') reasoning += payload.text;
    else if (payload.kind === 'image') imageCount++;
    else if (event.event === 'stop') finishReason = event.data;
    else if (event.event === 'usage') usage = event.data;
  }

  if (json) {
    console.log(
      JSON.stringify({ content, finishReason, reasoning: reasoning || undefined, usage }, null, 2),
    );
    return;
  }

  process.stdout.write(content);
  process.stdout.write('\n');
  if (!content && imageCount > 0) warnImageOnlyReply(imageCount);
}
