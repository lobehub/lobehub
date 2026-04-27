import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { confirm, outputJson, printTable, timeAgo, truncate } from '../../utils/format';
import { registerAsrCommand } from './asr';
import { registerImageCommand } from './image';
import { registerTextCommand } from './text';
import { registerTtsCommand } from './tts';
import { registerVideoCommand } from './video';

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
        const code = err?.data?.code || err?.shape?.data?.code;
        const isNotFound = code === 'NOT_FOUND' || err?.message?.includes('NOT_FOUND');
        const isServerError =
          code === 'INTERNAL_SERVER_ERROR' || err?.message?.includes('async_tasks');

        if (isNotFound || isServerError) {
          console.error(
            `${pc.red('✗')} Task not found: ${pc.bold(asyncTaskId)}\n` +
              `\n` +
              `  Make sure you are passing the correct ${pc.bold('asyncTaskId')} (the UUID shown\n` +
              `  after "→ Task" in the video/image output), not the generation ID (gen_xxx).\n` +
              `\n` +
              `  Example output from "lh gen video":\n` +
              `    Generation ${pc.bold('gen_abc123')} → Task ${pc.dim('7ad0eb13-e9a5-4403-8070-1f7fe95b2f95')}\n` +
              `\n` +
              `  Correct usage:\n` +
              `    ${pc.cyan('lh gen status gen_abc123 7ad0eb13-e9a5-4403-8070-1f7fe95b2f95')}`,
          );
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
            const code = err?.data?.code || err?.shape?.data?.code;
            const isNotFound = code === 'NOT_FOUND' || err?.message?.includes('NOT_FOUND');
            const isServerError =
              code === 'INTERNAL_SERVER_ERROR' || err?.message?.includes('async_tasks');

            if (isNotFound || isServerError) {
              console.error(
                `\n${pc.red('✗')} Task not found: ${pc.bold(asyncTaskId)}\n` +
                  `\n` +
                  `  Make sure you are passing the correct ${pc.bold('asyncTaskId')} (the UUID shown\n` +
                  `  after "→ Task" in the video/image output), not the generation ID (gen_xxx).\n` +
                  `\n` +
                  `  Example output from "lh gen video":\n` +
                  `    Generation ${pc.bold('gen_abc123')} → Task ${pc.dim('7ad0eb13-e9a5-4403-8070-1f7fe95b2f95')}\n` +
                  `\n` +
                  `  Correct usage:\n` +
                  `    ${pc.cyan('lh gen download gen_abc123 7ad0eb13-e9a5-4403-8070-1f7fe95b2f95')}`,
              );
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
