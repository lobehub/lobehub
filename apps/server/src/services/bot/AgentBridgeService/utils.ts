import type { ChatTopicBotContext } from '@lobechat/types';
import debug from 'debug';

import type { PlatformClient } from '../platforms';

const log = debug('lobe-server:bot:agent-bridge');

/**
 * `acquireTopicStartReservation` gives up with this message when the topic's
 * `runningOperation` stayed alive through its bounded backoff.
 */
export const isTopicBusyError = (errMsg: string): boolean => errMsg.includes('remained busy');

/**
 * Convert hook-event JSON-safe attachments (`{ data?: base64, fetchUrl? }`)
 * into chat-sdk `Attachment` shape (`{ data?: Buffer, url? }`) so they can
 * ride along `thread.post({ markdown, attachments })` in local mode. Returns
 * `undefined` when there are no attachments to send.
 */
export function hookEventAttachmentsToChatSdk(
  attachments:
    | Array<{
        data?: string;
        fetchUrl?: string;
        mimeType?: string;
        name?: string;
        type: 'image' | 'file' | 'video' | 'audio';
      }>
    | undefined,
):
  | Array<{
      data?: Buffer;
      mimeType?: string;
      name?: string;
      type: 'image' | 'file' | 'video' | 'audio';
      url?: string;
    }>
  | undefined {
  if (!attachments?.length) return undefined;
  const out = [];
  for (const att of attachments) {
    if (att.fetchUrl) {
      out.push({
        mimeType: att.mimeType,
        name: att.name,
        type: att.type,
        url: att.fetchUrl,
      });
    } else if (att.data) {
      out.push({
        data: Buffer.from(att.data, 'base64'),
        mimeType: att.mimeType,
        name: att.name,
        type: att.type,
      });
    }
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Extract a human-readable error message from agent runtime error objects.
 * Handles various shapes: string, { message }, { errorType, error: { stack } }, etc.
 */
export function extractErrorMessage(err: unknown): string {
  if (!err) return 'Agent execution failed';
  if (typeof err === 'string') return err;

  const e = err as Record<string, any>;

  // { message: '...' }
  if (typeof e.message === 'string') return e.message;

  // { errorType: 'ProviderBizError', error: { stack: 'Error: ...\n  at ...' } }
  if (e.error?.stack) {
    const firstLine = String(e.error.stack).split('\n')[0];
    const prefix = e.errorType ? `[${e.errorType}] ` : '';
    return `${prefix}${firstLine}`;
  }

  // { body: { message: '...' } }
  if (typeof e.body?.message === 'string') return e.body.message;

  return JSON.stringify(err);
}

/**
 * Fire-and-forget wrapper for non-essential side effects (reactions, typing
 * indicators, subscribe, etc.). These are UX niceties — a transient platform
 * network error must NEVER abort the main message flow, because the abort
 * would skip the cleanup of `activeThreads` and freeze the thread.
 */
export async function safeSideEffect(fn: () => Promise<unknown>, label: string): Promise<void> {
  try {
    await fn();
  } catch (error) {
    log('safeSideEffect [%s] failed: %O', label, error);
  }
}

/**
 * Resolve the `{ platform, channelId }` pair the `lobe-message` tool needs to
 * act on the conversation this run is replying in.
 *
 * `PlatformClient.extractChatId` is the decoder each platform already uses for
 * its own outbound calls, so what it returns is by construction what that
 * platform's message service accepts as `channelId` — Feishu/Lark `oc_…`,
 * Discord channel-or-thread id, Telegram chat id. A platform whose history
 * read cannot be scoped that precisely (a Slack reply thread decodes to its
 * parent channel) overrides `extractConversationId` and returns undefined, and
 * the block is omitted rather than pointing the model at the wrong history.
 *
 * Returns undefined when we have no bot context or no client (e.g. a run that
 * didn't originate from an IM thread) — the prompt block is then simply omitted.
 */
export function resolveCurrentChannel(
  botContext: ChatTopicBotContext | undefined,
  client: PlatformClient | undefined,
): { id: string; platformId: string } | undefined {
  if (!botContext?.platformThreadId || !client) return undefined;
  try {
    const id = client.extractConversationId
      ? client.extractConversationId(botContext.platformThreadId)
      : client.extractChatId(botContext.platformThreadId);
    if (!id) return undefined;
    return { id, platformId: botContext.platform };
  } catch (error) {
    // A malformed/legacy threadId must never break the run — the model just
    // loses the shortcut and falls back to asking, which is today's behavior.
    log('resolveCurrentChannel: failed to extract chat id (non-fatal): %O', error);
    return undefined;
  }
}
