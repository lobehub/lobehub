import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { confirm, outputJson, printTable, timeAgo, truncate } from '../../utils/format';
import { registerAsrCommand } from './asr';
import { registerImageCommand } from './image';
import { registerTextCommand } from './text';
import { registerTtsCommand } from './tts';
import { registerVideoCommand } from './video';

/**
 * Parse a tRPC/server error and return a user-friendly message for gen status/download.
 *
 * getGenerationStatus throws NOT_FOUND in two distinct cases:
 *   1. "Async task not found"  → asyncTaskId is wrong (user passed gen_xxx instead of UUID)
 *   2. "Generation not found"  → generationId is wrong
 *
 * INTERNAL_SERVER_ERROR with a message mentioning "async_tasks" also indicates a bad asyncTaskId
 * (e.g. the server SQL query fails when a non-UUID is passed).
 */
function parseGenStatusError(
  err: any,
  generationId: string,
  asyncTaskId: string,
  command: 'status' | 'download',
): string | null {
  const code = err?.data?.code || err?.shape?.data?.code;
  const message: string = err?.message || err?.shape?.message || '';

  const isAsyncTaskNotFound =
    (code === 'NOT_FOUND' && message.includes('Async task not found')) ||
    (code === 'INTERNAL_SERVER_ERROR' && message.includes('async_tasks'));

  const isGenerationNotFound = code === 'NOT_FOUND' && message.includes('Generation not found');

  if (isAsyncTaskNotFound) {
    return (
      `${pc.red('✗')} Async task not found: ${pc.bold(asyncTaskId)}\n` +
      `\n` +
      `  The second argument must be the ${pc.bold('asyncTaskId')} — the UUID printed after\n` +
      `  "→ Task" in the video/image output, not the generation ID (gen_xxx).\n` +
      `\n` +
      `  Example output from "lh gen video":\n` +
      `    Generation ${pc.bold('gen_abc123')} → Task ${pc.dim('7ad0eb13-e9a5-4403-8070-1f7fe95b2f95')}\n` +
      `\n` +
      `  Correct usage:\n` +
      `    ${pc.cyan(`lh gen ${command} gen_abc123 7ad0eb13-e9a5-4403-8070-1f7fe95b2f95`)}`
    );
  }

  if (isGenerationNotFound) {
    return (
      `${pc.red('✗')} Generation not found: ${pc.bold(generationId)}\n` +
      `\n` +
      `  The first argument must be the ${pc.bold('generationId')} (gen_xxx) from the\n` +
      `  video/image output.\n` +
      `\n` +
      `  Correct usage:\n` +
      `    ${pc.cyan(`lh gen ${command} <generationId> <asyncTaskId>`)}`
    );
  }

  return null;
}

export function registerGenerateCommand(program: Command) {
  const generate = program
    .command('generate')
    .alias('gen')
    .description('Generate content (text, image, video, speech)');

  registerTextCommand(generate);
  registerImageCommand(generate);
  registerVideoCommand(generate);
  registerTtsCommand(generate);
  registerAsrCommand(generate);

  // ── status ──────────────────────────────────────────
  generate
    .command('status <generationId> <asyncTaskId>')
    .description('Check generation task status')
    .option('--json', 'Output raw JSON')
    .action(async (generationId: string, asyncTaskId: string, options: { json?: boolean }) => {
      const client = await getTrpcClient();

      let result: any;
      try {
        result = await client.generation.getGenerationStatus.query({
          asyncTaskId,
          generationId,
        });
      } catch (err: any) {
        const msg = parseGenStatusError(err, generationId, asyncTaskId, 'status');
        if (msg) {
          console.error(msg);
          process.exit(1);
        }
        throw err;
      }

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

  // ── download ──────────────────────────────────────────
  generate
    .command('download <generationId> <asyncTaskId>')
    .description('Wait for generation to complete and download the result')
    .option('-o, --output <path>', 'Output file path (default: auto-detect from asset)')
    .option('--interval <sec>', 'Polling interval in seconds', '5')
    .option('--timeout <sec>', 'Timeout in seconds (0 = no timeout)', '300')
    .action(
      async (
        generationId: string,
        asyncTaskId: string,
        options: { interval?: string; output?: string; timeout?: string },
      ) => {
        const client = await getTrpcClient();
        const interval = Number.parseInt(options.interval || '5', 10) * 1000;
        const timeout = Number.parseInt(options.timeout || '300', 10) * 1000;
        const startTime = Date.now();

        console.log(`${pc.yellow('⋯')} Waiting for generation ${pc.bold(generationId)}...`);

        // Poll for completion
        while (true) {
          let result: any;
          try {
            result = await client.generation.getGenerationStatus.query({
              asyncTaskId,
              generationId,
            });
          } catch (err: any) {
            const msg = parseGenStatusError(err, generationId, asyncTaskId, 'download');
            if (msg) {
              console.error(`\n${msg}`);
              process.exit(1);
            }
            throw err;
          }

          if (result.status === 'success' && result.generation) {
            const gen = result.generation;
            const url = gen.asset?.url;

            if (!url) {
              console.log(`${pc.red('✗')} Generation succeeded but no asset URL found.`);
              process.exit(1);
            }

            // Determine output path
            const ext = url.split('?')[0].split('.').pop() || 'bin';
            const outputPath = options.output || `${generationId}.${ext}`;

            console.log(`${pc.green('✓')} Generation complete. Downloading...`);

            // Download
            const res = await fetch(url);
            if (!res.ok) {
              console.log(`${pc.red('✗')} Download failed: ${res.status} ${res.statusText}`);
              process.exit(1);
            }

            const { writeFile } = await import('node:fs/promises');
            const buffer = Buffer.from(await res.arrayBuffer());
            await writeFile(outputPath, buffer);

            console.log(
              `${pc.green('✓')} Saved to ${pc.bold(outputPath)} (${(buffer.length / 1024).toFixed(1)} KB)`,
            );
            if (gen.asset?.thumbnailUrl) {
              console.log(`  Thumbnail: ${pc.dim(gen.asset.thumbnailUrl)}`);
            }
            return;
          }

          if (result.status === 'error') {
            const errMsg =
              result.error?.body?.detail || result.error?.message || JSON.stringify(result.error);
            console.log(`${pc.red('✗')} Generation failed: ${errMsg}`);
            process.exit(1);
          }

          // Check timeout
          if (timeout > 0 && Date.now() - startTime > timeout) {
            console.log(
              `${pc.red('✗')} Timed out after ${options.timeout}s. Task still ${result.status}.`,
            );
            console.log(pc.dim(`Run "lh gen status ${generationId} ${asyncTaskId}" to check later.`));
            process.exit(1);
          }

          process.stdout.write(
            `\r${pc.yellow('⋯')} Status: ${colorStatus(result.status)}... (${Math.round((Date.now() - startTime) / 1000)}s)`,
          );
          await new Promise((r) => setTimeout(r, interval));
        }
      },
    );

  // ── delete ─────────────────────────────────────────
  generate
    .command('delete <generationId>')
    .description('Delete a generation record')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (generationId: string, options: { yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm('Are you sure you want to delete this generation?');
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();
      await client.generation.deleteGeneration.mutate({ generationId });
      console.log(`${pc.green('✓')} Deleted generation ${pc.bold(generationId)}`);
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

export function colorStatus(status: string): string {
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
