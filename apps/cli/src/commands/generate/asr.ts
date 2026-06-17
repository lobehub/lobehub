import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';

import { getAuthInfo } from '../../api/http';
import { log } from '../../utils/logger';

export function registerAsrCommand(parent: Command) {
  parent
    .command('asr <audio-file>')
    .description(
      'Convert speech to text (automatic speech recognition). Accepts a local path or a URL',
    )
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
        const isUrl = audioFile.startsWith('http://') || audioFile.startsWith('https://');

        if (!isUrl && !existsSync(audioFile)) {
          log.error(`File not found: ${audioFile}`);
          process.exit(1);
          return;
        }

        const { serverUrl, headers } = await getAuthInfo();

        const sttOptions: Record<string, any> = { model: options.model };
        if (options.language) sttOptions.language = options.language;

        let fileBuffer: Blob;
        let fileName: string;
        try {
          if (isUrl) {
            ({ blob: fileBuffer, name: fileName } = await fetchAudioFromUrl(audioFile));
          } else {
            fileBuffer = await readFileAsBlob(audioFile);
            fileName = path.basename(audioFile);
          }
        } catch (error) {
          log.error(error instanceof Error ? error.message : String(error));
          process.exit(1);
          return;
        }

        const formData = new FormData();
        formData.append('speech', fileBuffer, fileName);
        formData.append('options', JSON.stringify(sttOptions));

        // Remove Content-Type for multipart/form-data (let fetch set it with boundary)
        const { 'Content-Type': _, ...formHeaders } = headers;

        const res = await fetch(`${serverUrl}/webapi/stt/openai`, {
          body: formData,
          headers: formHeaders,
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
}

async function readFileAsBlob(filePath: string): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    chunks.push(chunk as Uint8Array);
  }
  return new Blob(chunks);
}

async function fetchAudioFromUrl(url: string): Promise<{ blob: Blob; name: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download audio: ${res.status} ${res.statusText}`);
  }

  const blob = await res.blob();

  // Derive a file name from the URL path, falling back to a generic name.
  const pathname = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return '';
    }
  })();
  const name = path.basename(pathname) || 'audio';

  return { blob, name };
}
