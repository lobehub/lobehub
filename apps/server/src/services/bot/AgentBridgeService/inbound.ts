import type { Message, Thread } from 'chat';
import debug from 'debug';

import type { AttachmentSource } from '@/server/services/aiAgent/ingestAttachment';

import { getSourceMessages } from '../mergeMessages';
import type { PlatformClient } from '../platforms';
import type { DiscordChannelContext, ThreadState } from './types';

const log = debug('lobe-server:bot:agent-bridge');

/**
 * Fetch channel context from the Chat SDK adapter.
 * Uses fetchThread to get channel name, and decodeThreadId to extract guild/channel IDs.
 */
export async function fetchChannelContext(
  thread: Thread<ThreadState>,
): Promise<DiscordChannelContext | undefined> {
  try {
    // Decode thread ID to get guild and channel IDs
    // Discord format: "discord:guildId:channelId[:threadId]"
    const decoded = thread.adapter.decodeThreadId(thread.id) as {
      channelId?: string;
      guildId?: string;
      threadId?: string;
    };

    if (!decoded?.guildId || !decoded?.channelId) {
      log('fetchChannelContext: could not decode guildId/channelId from thread %s', thread.id);
      return undefined;
    }

    // Fetch parent channel info
    const channelInfo = await thread.adapter.fetchThread(thread.id);
    const raw = channelInfo.metadata?.raw as { topic?: string; type?: number } | undefined;

    const context: DiscordChannelContext = {
      channel: {
        id: decoded.channelId,
        name: channelInfo.channelName,
        topic: raw?.topic,
        type: raw?.type,
      },
      guild: { id: decoded.guildId },
    };

    // When in a Discord thread, also fetch thread info.
    // Discord threads are channels, so we can fetch via /channels/{threadId}
    // by constructing a synthetic composite ID with threadId as the channelId slot.
    if (decoded.threadId) {
      try {
        const syntheticId = `discord:${decoded.guildId}:${decoded.threadId}`;
        const threadInfoResult = await thread.adapter.fetchThread(syntheticId);
        context.thread = {
          id: decoded.threadId,
          name: threadInfoResult.channelName,
        };
        log('fetchChannelContext: thread=%s (%s)', decoded.threadId, threadInfoResult.channelName);
      } catch (threadError) {
        log('fetchChannelContext: failed to fetch thread info: %O', threadError);
        // Still include thread ID even if name fetch fails
        context.thread = { id: decoded.threadId };
      }
    }

    log(
      'fetchChannelContext: guild=%s, channel=%s (%s), thread=%s',
      decoded.guildId,
      decoded.channelId,
      channelInfo.channelName,
      context.thread?.name ?? 'none',
    );

    return context;
  } catch (error) {
    log('fetchChannelContext: failed to fetch channel context: %O', error);
    return undefined;
  }
}

/**
 * Resolve attachments on an inbound message into `AttachmentSource[]` by
 * delegating to the platform client's own `extractFiles`. Each platform
 * owns its own attachment quirks (auth, file_id paths, mime/name
 * inference, quoted-msg handling, post-Redis refetch); the bridge stays
 * platform-agnostic.
 *
 * Returns undefined when no client is provided or the client returns no
 * attachments. (The legacy bridge fallback `extractFiles` was deleted
 * once all 6 platforms migrated to per-client extraction — see Step 2
 * of the per-platform extractFiles refactor.)
 */
export async function resolveFiles(
  message: Message,
  client?: PlatformClient,
): Promise<{
  files?: Array<{
    buffer?: Buffer;
    mimeType?: string;
    name?: string;
    size?: number;
    url?: string;
  }>;
  warnings?: string[];
}> {
  if (!client?.extractFiles) return {};

  // A merged message (Chat SDK queue/debounce `skipped` context, or a
  // deferred-message replay) carries only the LAST message's `raw`, but
  // every platform's `extractFiles` reads media descriptors from `raw`. Walk
  // each source message so an image that arrived one message before the
  // text is still downloaded.
  const sources = getSourceMessages(message);
  const files: AttachmentSource[] = [];
  const warnings: string[] = [];
  let sawResult = false;

  for (const source of sources) {
    const result = await client.extractFiles(source);
    if (!result) continue;
    sawResult = true;
    if (Array.isArray(result)) {
      files.push(...result);
      continue;
    }
    if (result.files) files.push(...result.files);
    if (result.warnings) warnings.push(...result.warnings);
  }

  if (!sawResult) return {};
  return {
    files,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
