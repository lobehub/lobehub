import type { Command } from 'commander';

import { getAuthInfo } from '../../api/http';
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
          // For non-streaming, use responseMode 'json' to get a plain JSON response
          // instead of SSE (the backend converts non-stream to SSE by default)
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

        if (!useStream) {
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

        // Stream SSE response
        if (!res.body) {
          log.error('No response body received');
          process.exit(1);
          return;
        }

        await streamSSEResponse(res.body, options.json);
      },
    );
}

async function streamSSEResponse(body: ReadableStream<Uint8Array>, json?: boolean): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') {
          if (!json) process.stdout.write('\n');
          return;
        }

        try {
          const parsed = JSON.parse(data);
          if (json) {
            console.log(JSON.stringify(parsed));
          } else if (typeof parsed === 'string' && parsed !== 'stop') {
            // LobeHub SSE sends content as JSON strings: "Hello", "world"
            process.stdout.write(parsed);
          } else if (parsed?.choices?.[0]?.delta?.content) {
            // Standard OpenAI SSE format
            process.stdout.write(parsed.choices[0].delta.content);
          }
        } catch {
          // Not JSON, might be raw text chunk
          if (!json) process.stdout.write(data);
        }
      }
    }
    // Final newline
    if (!json) process.stdout.write('\n');
  } finally {
    reader.releaseLock();
  }
}
