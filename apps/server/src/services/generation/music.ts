import { createHash } from 'node:crypto';

import { type LobeChatDatabase } from '@lobechat/database';
import type { MusicTrack } from '@lobechat/model-runtime';
import { ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import debug from 'debug';
import { nanoid } from 'nanoid';

import { FileService } from '@/server/services/file';
import { getYYYYmmddHHMMss } from '@/utils/time';

const log = debug('lobe-music:generation-service');

export interface MusicProcessResult {
  audioKey: string;
  /** Storage key of the cover art, when the provider returned one and it could be stored */
  coverKey?: string;
  duration?: number;
  fileHash: string;
  fileSize: number;
  mimeType: string;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.pcm': 'audio/pcm',
  '.wav': 'audio/wav',
};

const EXTENSION_BY_MIME: Record<string, string> = {
  'audio/aac': '.aac',
  'audio/flac': '.flac',
  'audio/l16': '.pcm',
  'audio/mp3': '.mp3',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/pcm': '.pcm',
  'audio/wav': '.wav',
  'audio/wave': '.wav',
  'audio/x-wav': '.wav',
};

const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const extensionOfUrl = (url: string) => {
  try {
    const match = /\.[a-z\d]{2,5}$/i.exec(new URL(url).pathname);
    return match?.[0].toLowerCase();
  } catch {
    return;
  }
};

/**
 * Pick the stored extension and MIME type of a track. The declared type wins over the URL;
 * an unknown or generic type falls back to the URL extension, then to MP3 (the default of
 * every supported provider).
 */
export const resolveAudioFormat = (
  contentType: string | null | undefined,
  url?: string,
): { ext: string; mimeType: string } => {
  const declared = contentType?.split(';')[0].trim().toLowerCase();
  if (declared && EXTENSION_BY_MIME[declared]) {
    const ext = EXTENSION_BY_MIME[declared];
    return { ext, mimeType: MIME_BY_EXTENSION[ext] };
  }

  const urlExt = url ? extensionOfUrl(url) : undefined;
  if (urlExt && MIME_BY_EXTENSION[urlExt])
    return { ext: urlExt, mimeType: MIME_BY_EXTENSION[urlExt] };

  return { ext: '.mp3', mimeType: 'audio/mpeg' };
};

/**
 * Stores generated songs in our own file storage. Provider audio URLs are temporary, so every
 * track is copied as soon as it is ready.
 */
export class MusicGenerationService {
  /** Max audio file size: 100 MB (a 5-minute WAV is about 50 MB) */
  static MAX_AUDIO_SIZE = 100 * 1024 * 1024;
  /** Max cover image size: 10 MB */
  static MAX_COVER_SIZE = 10 * 1024 * 1024;
  /** Download timeout: 2 minutes */
  static DOWNLOAD_TIMEOUT_MS = 2 * 60 * 1000;

  private fileService: FileService;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.fileService = new FileService(db, userId, workspaceId);
  }

  /**
   * Download (or take the inline bytes of) one track and its cover, and upload them to storage.
   */
  async processTrack(track: MusicTrack): Promise<MusicProcessResult> {
    let buffer: Buffer;
    let contentType = track.contentType;

    if (track.audio) {
      buffer = Buffer.from(track.audio);
      if (buffer.length > MusicGenerationService.MAX_AUDIO_SIZE)
        throw new Error(
          `Audio file too large: ${buffer.length} bytes (max ${MusicGenerationService.MAX_AUDIO_SIZE} bytes)`,
        );
    } else if (track.audioUrl) {
      const downloaded = await this.download(track.audioUrl, MusicGenerationService.MAX_AUDIO_SIZE);
      buffer = downloaded.buffer;
      // The provider's declared type is more specific than a CDN's generic octet-stream
      contentType = contentType || downloaded.contentType;
    } else {
      throw new Error('The provider returned a track without audio');
    }

    if (buffer.length === 0) throw new Error('The provider returned an empty audio file');

    const { ext, mimeType } = resolveAudioFormat(contentType, track.audioUrl);
    const uuid = nanoid();
    const dateTime = getYYYYmmddHHMMss(new Date());
    const folder = 'generations/music';

    const audioKey = `${folder}/${uuid}_${dateTime}_audio${ext}`;
    log('Uploading audio (%d bytes) to: %s', buffer.length, audioKey);
    await this.fileService.uploadBuffer(audioKey, buffer, mimeType);

    const coverKey = track.imageUrl
      ? await this.storeCover(track.imageUrl, `${folder}/${uuid}_${dateTime}_cover`)
      : undefined;

    return {
      audioKey,
      coverKey,
      duration: track.duration,
      fileHash: createHash('sha256').update(buffer).digest('hex'),
      fileSize: buffer.length,
      mimeType,
    };
  }

  /** Cover art is decoration: a failed download must not fail the song. */
  private async storeCover(url: string, keyWithoutExt: string): Promise<string | undefined> {
    try {
      const { buffer, contentType } = await this.download(
        url,
        MusicGenerationService.MAX_COVER_SIZE,
      );
      const declared = contentType?.split(';')[0].trim().toLowerCase();
      const ext = (declared && IMAGE_EXTENSION_BY_MIME[declared]) || extensionOfUrl(url) || '.jpg';
      const key = `${keyWithoutExt}${ext}`;
      await this.fileService.uploadBuffer(key, buffer, declared || 'image/jpeg');
      return key;
    } catch (error) {
      log('Skipping cover %s: %O', url, error);
      return;
    }
  }

  /**
   * Download a provider URL. The URL comes from the provider response, so it goes through
   * ssrfSafeFetch (private IPs blocked on every redirect hop), and the body is streamed with a
   * running byte count so a response without `content-length` cannot exceed `maxSize`.
   */
  private async download(
    url: string,
    maxSize: number,
  ): Promise<{ buffer: Buffer; contentType?: string }> {
    const response = await ssrfSafeFetch(url, {
      signal: AbortSignal.timeout(MusicGenerationService.DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
    }

    const contentLength = Number(response.headers.get('content-length'));
    if (contentLength && contentLength > maxSize) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`File too large: ${contentLength} bytes (max ${maxSize} bytes)`);
    }

    const chunks: Uint8Array[] = [];
    let size = 0;
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxSize) {
          await reader.cancel().catch(() => {});
          throw new Error(`File too large: exceeded ${maxSize} bytes during download`);
        }
        chunks.push(value);
      }
    }

    return {
      buffer: Buffer.concat(chunks),
      contentType: response.headers.get('content-type') ?? undefined,
    };
  }
}
