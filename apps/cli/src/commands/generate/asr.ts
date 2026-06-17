import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Command } from 'commander';

import { getTrpcClient } from '../../api/client';
import { log } from '../../utils/logger';

export function registerAsrCommand(parent: Command) {
  parent
    .command('asr <audio-file>')
    .description(
      'Convert speech to text (automatic speech recognition). Accepts a local path or a URL',
    )
    .option('--model <model>', 'STT model', 'whisper-1')
    .option('--provider <provider>', 'AI provider', 'openai')
    .option('--language <lang>', 'Language code (e.g. en, zh)')
    .option('--json', 'Output raw JSON')
    .action(
      async (
        audioFile: string,
        options: {
          json?: boolean;
          language?: string;
          model: string;
          provider: string;
        },
      ) => {
        const isUrl = audioFile.startsWith('http://') || audioFile.startsWith('https://');

        if (!isUrl && !existsSync(audioFile)) {
          log.error(`File not found: ${audioFile}`);
          process.exit(1);
          return;
        }

        let bytes: Uint8Array;
        let fileName: string;
        try {
          if (isUrl) {
            ({ bytes, name: fileName } = await fetchAudioFromUrl(audioFile));
          } else {
            bytes = await readFile(audioFile);
            fileName = path.basename(audioFile);
          }
        } catch (error) {
          log.error(error instanceof Error ? error.message : String(error));
          process.exit(1);
          return;
        }

        try {
          const client = await getTrpcClient();
          const result = await client.asr.transcribe.mutate({
            audioBase64: Buffer.from(bytes).toString('base64'),
            fileName,
            language: options.language,
            model: options.model,
            provider: options.provider,
          });

          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            process.stdout.write(result.text);
            process.stdout.write('\n');
          }
        } catch (error) {
          log.error(`ASR failed: ${error instanceof Error ? error.message : String(error)}`);
          process.exit(1);
        }
      },
    );
}

async function fetchAudioFromUrl(url: string): Promise<{ bytes: Uint8Array; name: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download audio: ${res.status} ${res.statusText}`);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());

  // Derive a file name from the URL path, falling back to a generic name.
  const pathname = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return '';
    }
  })();
  const name = path.basename(pathname) || 'audio';

  return { bytes, name };
}
