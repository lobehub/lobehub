import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { outputJson, printTable, timeAgo, truncate } from '../../utils/format';
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
