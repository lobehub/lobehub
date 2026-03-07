import { createReadStream, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { getAuthInfo } from '../api/http';
import { outputJson, printTable, timeAgo, truncate } from '../utils/format';
import { log } from '../utils/logger';

export function registerGenerateCommand(program: Command) {
  const generate = program
    .command('generate')
    .alias('gen')
    .description('Generate content (text, image, video, speech)');

  // ── text ────────────────────────────────────────────
  generate
    .command('text <prompt>')
    .description('Generate text with an LLM (single completion, no tools)')
    .option('-m, --model <model>', 'Model ID', 'openai/gpt-4o-mini')
    .option('-p, --provider <provider>', 'Provider name (derived from model if omitted)')
    .option('-s, --system <prompt>', 'System prompt')
    .option('--temperature <n>', 'Temperature (0-2)')
    .option('--max-tokens <n>', 'Maximum output tokens')
    .option('--no-stream', 'Disable streaming (wait for full response)')
    .option('--json', 'Output raw JSON instead of text')
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

        const payload: Record<string, any> = {
          messages,
          model,
          stream: options.stream !== false,
        };
        if (options.temperature) payload.temperature = Number.parseFloat(options.temperature);
        if (options.maxTokens) payload.max_tokens = Number.parseInt(options.maxTokens, 10);

        const { serverUrl, accessToken } = await getAuthInfo();

        const res = await fetch(`${serverUrl}/webapi/chat/${provider}`, {
          body: JSON.stringify(payload),
          headers: {
            'Content-Type': 'application/json',
            'Oidc-Auth': accessToken,
          },
          method: 'POST',
        });

        if (!res.ok) {
          const text = await res.text();
          log.error(`Text generation failed: ${res.status} ${text}`);
          process.exit(1);
          return;
        }

        if (!payload.stream) {
          const body = await res.json();
          if (options.json) {
            console.log(JSON.stringify(body, null, 2));
          } else {
            const content = body.choices?.[0]?.message?.content || JSON.stringify(body);
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

  // ── image ───────────────────────────────────────────
  generate
    .command('image <prompt>')
    .description('Generate an image from text')
    .option('-m, --model <model>', 'Model ID', 'dall-e-3')
    .option('-p, --provider <provider>', 'Provider name', 'openai')
    .option('-n, --num <n>', 'Number of images', '1')
    .option('--width <px>', 'Width in pixels')
    .option('--height <px>', 'Height in pixels')
    .option('--steps <n>', 'Number of steps')
    .option('--seed <n>', 'Random seed')
    .option('--json', 'Output raw JSON')
    .action(
      async (
        prompt: string,
        options: {
          height?: string;
          json?: boolean;
          model: string;
          num: string;
          provider: string;
          seed?: string;
          steps?: string;
          width?: string;
        },
      ) => {
        const client = await getTrpcClient();

        // Create a generation topic first
        const topicId = await client.generationTopic.createTopic.mutate({ type: 'image' });

        const params: Record<string, any> = { prompt };
        if (options.width) params.width = Number.parseInt(options.width, 10);
        if (options.height) params.height = Number.parseInt(options.height, 10);
        if (options.steps) params.steps = Number.parseInt(options.steps, 10);
        if (options.seed) params.seed = Number.parseInt(options.seed, 10);

        const result = await client.image.createImage.mutate({
          generationTopicId: topicId as string,
          imageNum: Number.parseInt(options.num, 10),
          model: options.model,
          params,
          provider: options.provider,
        });

        const r = result as any;
        if (options.json) {
          console.log(JSON.stringify(r, null, 2));
          return;
        }

        console.log(`${pc.green('✓')} Image generation started`);
        if (r.batch?.id) console.log(`  Batch ID: ${pc.bold(r.batch.id)}`);

        const generations = r.generations || [];
        if (generations.length > 0) {
          console.log(`  ${generations.length} image(s) queued`);
          for (const gen of generations) {
            if (gen.asyncTaskId) {
              console.log(`  Generation ${pc.bold(gen.id)} → Task ${pc.dim(gen.asyncTaskId)}`);
            }
          }
          console.log();
          console.log(
            pc.dim('Use "lh generate status <generationId> <taskId>" to check progress.'),
          );
        }
      },
    );

  // ── video ───────────────────────────────────────────
  generate
    .command('video <prompt>')
    .description('Generate a video from text')
    .option('-m, --model <model>', 'Model ID')
    .option('-p, --provider <provider>', 'Provider name')
    .option('--aspect-ratio <ratio>', 'Aspect ratio (e.g. 16:9)')
    .option('--duration <sec>', 'Duration in seconds')
    .option('--resolution <res>', 'Resolution (e.g. 720p, 1080p)')
    .option('--seed <n>', 'Random seed')
    .option('--json', 'Output raw JSON')
    .action(
      async (
        prompt: string,
        options: {
          aspectRatio?: string;
          duration?: string;
          json?: boolean;
          model?: string;
          provider?: string;
          resolution?: string;
          seed?: string;
        },
      ) => {
        if (!options.model || !options.provider) {
          log.error('Video generation requires --model and --provider.');
          process.exit(1);
          return;
        }

        const client = await getTrpcClient();
        const topicId = await client.generationTopic.createTopic.mutate({ type: 'video' });

        const params: Record<string, any> = { prompt };
        if (options.aspectRatio) params.aspectRatio = options.aspectRatio;
        if (options.duration) params.duration = Number.parseInt(options.duration, 10);
        if (options.resolution) params.resolution = options.resolution;
        if (options.seed) params.seed = Number.parseInt(options.seed, 10);

        const result = await client.video.createVideo.mutate({
          generationTopicId: topicId as string,
          model: options.model,
          params,
          provider: options.provider,
        });

        const r = result as any;
        if (options.json) {
          console.log(JSON.stringify(r, null, 2));
          return;
        }

        console.log(`${pc.green('✓')} Video generation started`);
        if (r.generationId) {
          console.log(`  Generation ID: ${pc.bold(r.generationId)}`);
        }
        console.log(
          pc.dim('Video generation runs asynchronously. Check status or wait for notification.'),
        );
      },
    );

  // ── tts ─────────────────────────────────────────────
  generate
    .command('tts <text>')
    .description('Convert text to speech')
    .option('-o, --output <file>', 'Output audio file path', 'output.mp3')
    .option('--voice <voice>', 'Voice name', 'alloy')
    .option('--speed <n>', 'Speed multiplier (0.25-4.0)', '1')
    .option('--model <model>', 'TTS model', 'tts-1')
    .option('--backend <backend>', 'TTS backend: openai, microsoft, edge', 'openai')
    .action(
      async (
        text: string,
        options: {
          backend: string;
          model: string;
          output: string;
          speed: string;
          voice: string;
        },
      ) => {
        const backends = ['openai', 'microsoft', 'edge'];
        if (!backends.includes(options.backend)) {
          log.error(`Invalid backend. Must be one of: ${backends.join(', ')}`);
          process.exit(1);
          return;
        }

        const { serverUrl, accessToken } = await getAuthInfo();

        const payload: Record<string, any> = {
          input: text,
          model: options.model,
          options: {
            model: options.model,
            voice: options.voice,
          },
          speed: Number.parseFloat(options.speed),
          voice: options.voice,
        };

        const res = await fetch(`${serverUrl}/webapi/tts/${options.backend}`, {
          body: JSON.stringify(payload),
          headers: {
            'Content-Type': 'application/json',
            'Oidc-Auth': accessToken,
          },
          method: 'POST',
        });

        if (!res.ok) {
          const errText = await res.text();
          log.error(`TTS failed: ${res.status} ${errText}`);
          process.exit(1);
          return;
        }

        const buffer = Buffer.from(await res.arrayBuffer());
        writeFileSync(options.output, buffer);
        console.log(
          `${pc.green('✓')} Audio saved to ${pc.bold(options.output)} (${Math.round(buffer.length / 1024)}KB)`,
        );
      },
    );

  // ── asr (speech-to-text) ────────────────────────────
  generate
    .command('asr <audio-file>')
    .description('Convert speech to text (automatic speech recognition)')
    .option('--model <model>', 'STT model', 'whisper-1')
    .option('--language <lang>', 'Language code (e.g. en, zh)')
    .option('--json', 'Output raw JSON')
    .action(
      async (
        audioFile: string,
        options: {
          json?: boolean;
          language?: string;
          model: string;
        },
      ) => {
        if (!existsSync(audioFile)) {
          log.error(`File not found: ${audioFile}`);
          process.exit(1);
          return;
        }

        const { serverUrl, accessToken } = await getAuthInfo();

        const sttOptions: Record<string, any> = { model: options.model };
        if (options.language) sttOptions.language = options.language;

        const formData = new FormData();
        const fileBuffer = await readFileAsBlob(audioFile);
        formData.append('speech', fileBuffer, path.basename(audioFile));
        formData.append('options', JSON.stringify(sttOptions));

        const res = await fetch(`${serverUrl}/webapi/stt/openai`, {
          body: formData,
          headers: {
            'Oidc-Auth': accessToken,
          },
          method: 'POST',
        });

        if (!res.ok) {
          const errText = await res.text();
          log.error(`ASR failed: ${res.status} ${errText}`);
          process.exit(1);
          return;
        }

        const result = await res.json();

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const text = (result as any).text || JSON.stringify(result);
          process.stdout.write(text);
          process.stdout.write('\n');
        }
      },
    );

  // ── status ──────────────────────────────────────────
  generate
    .command('status <generationId> <taskId>')
    .description('Check generation task status')
    .option('--json', 'Output raw JSON')
    .action(async (generationId: string, taskId: string, options: { json?: boolean }) => {
      const client = await getTrpcClient();
      const result = await client.generation.getGenerationStatus.query({
        asyncTaskId: taskId,
        generationId,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const r = result as any;
      console.log(`Status: ${colorStatus(r.status)}`);
      if (r.error) {
        console.log(`Error:  ${pc.red(r.error.message || JSON.stringify(r.error))}`);
      }
      if (r.generation) {
        const gen = r.generation;
        console.log(`  ID:    ${gen.id}`);
        if (gen.asset?.url) console.log(`  URL:   ${gen.asset.url}`);
        if (gen.asset?.thumbnailUrl) console.log(`  Thumb: ${gen.asset.thumbnailUrl}`);
      }
    });

  // ── list ────────────────────────────────────────────
  generate
    .command('list')
    .description('List generation topics')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.generationTopic.getAllGenerationTopics.query();
      const items = Array.isArray(result) ? result : [];

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(items, fields);
        return;
      }

      if (items.length === 0) {
        console.log('No generation topics found.');
        return;
      }

      const rows = items.map((t: any) => [
        t.id || '',
        truncate(t.title || 'Untitled', 40),
        t.type || '',
        t.updatedAt ? timeAgo(t.updatedAt) : '',
      ]);

      printTable(rows, ['ID', 'TITLE', 'TYPE', 'UPDATED']);
    });
}

// ── Helpers ──────────────────────────────────────────────

function colorStatus(status: string): string {
  switch (status) {
    case 'success': {
      return pc.green(status);
    }
    case 'error': {
      return pc.red(status);
    }
    case 'processing': {
      return pc.yellow(status);
    }
    case 'pending': {
      return pc.cyan(status);
    }
    default: {
      return status;
    }
  }
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
          } else {
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) process.stdout.write(content);
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

async function readFileAsBlob(filePath: string): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    chunks.push(chunk as Uint8Array);
  }
  return new Blob(chunks);
}
