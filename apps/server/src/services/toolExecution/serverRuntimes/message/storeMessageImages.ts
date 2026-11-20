import { createHash } from 'node:crypto';

import type {
  MessageImageCandidate,
  MessageImageResolver,
  MessageToolImage,
} from '@lobechat/builtin-tool-message/executionRuntime';
import type { LobeChatDatabase } from '@lobechat/database';
import { ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import { readBlobWithLimit } from '@lobechat/utils/imageToBase64';
import debug from 'debug';
import pMap from 'p-map';

import { FileService } from '@/server/services/file';

import { resolveContentWorkspaceId } from '../resolveWorkspaceScope';

const log = debug('lobe-server:message-runtime:images');

/**
 * Hosts whose attachment URLs are public and need no credentials. Slack (`url_private`) and the
 * others need the bot token to download, so their images stay text markers for now.
 */
const ALLOWED_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

/** Anthropic rejects images above 5 MB; the smallest provider limit wins. */
export const MAX_MESSAGE_IMAGE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
/** Downloads and uploads run a couple at a time; a page carries at most a few images anyway. */
const STORE_CONCURRENCY = 2;

const isAllowedUrl = (raw: string) => {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
};

const safeName = (name: string) => name.replaceAll(/[^\w.-]/g, '_').slice(-80) || 'image';

/**
 * One object key per attachment. Two attachments of a message can share a file name (or collide
 * once sanitized), so the key carries a hash of the attachment URL's path, which names the
 * attachment itself (Discord: `/attachments/{channel}/{attachment}/{file}`).
 */
export const messageImageKey = (candidate: MessageImageCandidate, date: string) => {
  const path = new URL(candidate.url).pathname;
  const id = createHash('sha256').update(path).digest('hex').slice(0, 12);
  return `files/${date}/im-${candidate.messageId}-${id}-${safeName(candidate.name)}`;
};

/** Downloads one image within the size and type limits; undefined when it does not qualify. */
const download = async (candidate: MessageImageCandidate) => {
  if (!isAllowedUrl(candidate.url)) return;
  if (candidate.size !== undefined && candidate.size > MAX_MESSAGE_IMAGE_BYTES) return;

  // The host allowlist is checked before the request; ssrfSafeFetch also validates the resolved
  // address at connect time and on every redirect hop, so DNS cannot point it inside.
  const response = await ssrfSafeFetch(
    candidate.url,
    { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    { maxContentLength: MAX_MESSAGE_IMAGE_BYTES + 1 },
  );
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`HTTP ${response.status}`);
  }

  const mediaType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (mediaType !== candidate.mediaType) {
    await response.body?.cancel().catch(() => {});
    return;
  }

  const blob = await readBlobWithLimit(response, MAX_MESSAGE_IMAGE_BYTES);
  const buffer = Buffer.from(await blob.arrayBuffer());
  if (buffer.length === 0) return;

  return buffer;
};

/**
 * Copies chat image attachments into file storage so the readMessages / searchMessages result
 * can show them to a vision model. Platform CDN links expire (Discord signs them for about a
 * day) and a bot topic outlives that, so the stored proxy URL is what the tool result keeps.
 *
 * Best-effort per image: one that is too large, of another type, off the host allowlist or
 * failing to download is left out, and the rest still ride on the result.
 */
export const createMessageImageStore = (context: {
  agentId?: string;
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
}): MessageImageResolver => {
  return async (candidates) => {
    const eligible = candidates.filter((candidate) => isAllowedUrl(candidate.url));
    if (eligible.length === 0) return [];

    const workspaceId = await resolveContentWorkspaceId({
      agentId: context.agentId,
      serverDB: context.serverDB,
      workspaceId: context.workspaceId ?? undefined,
    } as never);
    const fileService = new FileService(context.serverDB, context.userId, workspaceId);
    const date = new Date().toISOString().slice(0, 10);

    const stored = await pMap(
      eligible,
      async (candidate): Promise<MessageToolImage | undefined> => {
        try {
          const buffer = await download(candidate);
          if (!buffer) return;

          const { fileId, url } = await fileService.uploadFromBuffer(
            buffer,
            candidate.mediaType,
            messageImageKey(candidate, date),
          );

          return {
            fileId,
            mediaType: candidate.mediaType,
            messageId: candidate.messageId,
            name: candidate.name,
            url,
          };
        } catch (error) {
          log('image %s skipped: %O', candidate.url, error);
        }
      },
      { concurrency: STORE_CONCURRENCY },
    );

    return stored.filter((image): image is MessageToolImage => !!image);
  };
};
