import type {
  MessageImageCandidate,
  MessageImageResolver,
  MessageToolImage,
} from '@lobechat/builtin-tool-message/executionRuntime';
import type { LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';

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

const isAllowedUrl = (raw: string) => {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
};

const safeName = (name: string) => name.replaceAll(/[^\w.-]/g, '_').slice(-80) || 'image';

/** Downloads one image within the size and type limits; undefined when it does not qualify. */
const download = async (candidate: MessageImageCandidate) => {
  if (!isAllowedUrl(candidate.url)) return;
  if (candidate.size !== undefined && candidate.size > MAX_MESSAGE_IMAGE_BYTES) return;

  const response = await fetch(candidate.url, {
    redirect: 'error',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const mediaType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (mediaType !== candidate.mediaType) return;
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_MESSAGE_IMAGE_BYTES) return;

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > MAX_MESSAGE_IMAGE_BYTES) return;

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

    const settled = await Promise.allSettled(
      eligible.map(async (candidate): Promise<MessageToolImage | undefined> => {
        const buffer = await download(candidate);
        if (!buffer) return;

        const { fileId, url } = await fileService.uploadFromBuffer(
          buffer,
          candidate.mediaType,
          `files/${date}/im-${candidate.messageId}-${safeName(candidate.name)}`,
        );

        return {
          fileId,
          mediaType: candidate.mediaType,
          messageId: candidate.messageId,
          name: candidate.name,
          url,
        };
      }),
    );

    return settled.flatMap((outcome, index) => {
      if (outcome.status === 'fulfilled') return outcome.value ? [outcome.value] : [];
      log('image %s skipped: %O', eligible[index].url, outcome.reason);
      return [];
    });
  };
};
