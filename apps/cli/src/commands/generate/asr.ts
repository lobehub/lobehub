import { existsSync, statSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { Command } from 'commander';

import { getTrpcClient } from '../../api/client';
import { log } from '../../utils/logger';
import { uploadLocalFile } from '../../utils/uploadLocalFile';

// Audio at or below this size is sent inline as base64; anything larger is
// uploaded first and transcribed by `fileId`. Kept in sync with the server-side
// inline cap in `apps/server/src/routers/lambda/asr.ts`.
const MAX_INLINE_AUDIO_BYTES = 3 * 1024 * 1024;

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

        // Resolve the input to a local file path (downloading URLs to a temp
        // file) so large audio can reuse the shared upload flow.
        let localPath: string;
        let fileName: string;
        let mimeType: string | undefined;
        let size: number;
        let tempPath: string | undefined;
        try {
          if (isUrl) {
            const downloaded = await fetchAudioFromUrl(audioFile);
            fileName = downloaded.name;
            mimeType = downloaded.mimeType;
            size = downloaded.bytes.byteLength;
            tempPath = path.join(os.tmpdir(), `lh-asr-${process.pid}-${Date.now()}-${fileName}`);
            await writeFile(tempPath, downloaded.bytes);
            localPath = tempPath;
          } else {
            localPath = audioFile;
            fileName = path.basename(audioFile);
            size = statSync(audioFile).size;
          }
        } catch (error) {
          log.error(error instanceof Error ? error.message : String(error));
          process.exit(1);
          return;
        }

        try {
          const client = await getTrpcClient();

          let result: { text: string };
          if (size > MAX_INLINE_AUDIO_BYTES) {
            // Large audio: upload to storage, then transcribe by fileId so the
            // bytes never travel inline through tRPC.
            process.stderr.write(
              `Audio is ${(size / 1024 / 1024).toFixed(1)}MB — uploading before transcription…\n`,
            );
            const record = (await uploadLocalFile(client, localPath)) as { id: string };
            result = await client.asr.transcribe.mutate({
              fileId: record.id,
              language: options.language,
              model: options.model,
              provider: options.provider,
            });
          } else {
            const bytes = await readFile(localPath);
            result = await client.asr.transcribe.mutate({
              audioBase64: Buffer.from(bytes).toString('base64'),
              fileName,
              language: options.language,
              mimeType,
              model: options.model,
              provider: options.provider,
            });
          }

          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            process.stdout.write(result.text);
            process.stdout.write('\n');
          }
        } catch (error) {
          log.error(`ASR failed: ${error instanceof Error ? error.message : String(error)}`);
          process.exit(1);
        } finally {
          if (tempPath) {
            await rm(tempPath, { force: true }).catch(() => {});
          }
        }
      },
    );
}

// Common audio MIME types mapped to a file extension the transcription
// provider can recognize. Keep the extensions within the set OpenAI's
// /audio/transcriptions endpoint accepts.
const AUDIO_MIME_TO_EXT: Record<string, string> = {
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/m4a': 'm4a',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/mpga': 'mp3',
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/webm': 'webm',
  'audio/x-m4a': 'm4a',
  'audio/x-wav': 'wav',
};

async function fetchAudioFromUrl(
  url: string,
): Promise<{ bytes: Uint8Array; mimeType?: string; name: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download audio: ${res.status} ${res.statusText}`);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());

  // Strip any parameters from the Content-Type (e.g. `audio/mpeg; charset=...`).
  const contentType = res.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  const mimeType = contentType?.startsWith('audio/') ? contentType : undefined;

  // Prefer the name the server advertises, then the URL path, then a fallback.
  const name =
    fileNameFromContentDisposition(res.headers.get('content-disposition')) ||
    basenameFromUrl(url) ||
    'audio';

  // Transcription providers infer the audio format from the file extension, so
  // make sure the name carries one. Signed URLs and /download endpoints often
  // have no extension in the path — in that case borrow it from the
  // Content-Type when we recognize it.
  const ext = contentType ? AUDIO_MIME_TO_EXT[contentType] : undefined;
  const finalName = path.extname(name) || !ext ? name : `${name}.${ext}`;

  return { bytes, mimeType, name: finalName };
}

// Extract a file name from a Content-Disposition header, handling both the
// plain `filename="x"` form and the RFC 5987 extended `filename*=UTF-8''x` form.
function fileNameFromContentDisposition(header: string | null): string | undefined {
  if (!header) return undefined;

  // Extended form takes precedence and may be percent-encoded.
  const extended = /filename\*=\s*(?:UTF-8|ISO-8859-1)?''([^;]+)/i.exec(header);
  if (extended?.[1]) {
    try {
      return path.basename(decodeURIComponent(extended[1].trim()));
    } catch {
      // Malformed encoding — fall through to the plain form.
    }
  }

  const plain = /filename=\s*"?([^";]+)"?/i.exec(header);
  const value = plain?.[1]?.trim();
  return value ? path.basename(value) : undefined;
}

// Derive the (URL-decoded) last path segment of a URL, if any.
function basenameFromUrl(url: string): string | undefined {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return undefined;
  }

  const base = path.basename(pathname);
  if (!base) return undefined;
  try {
    return decodeURIComponent(base);
  } catch {
    return base;
  }
}
