import type { Message } from 'chat';

import { getSameSenderMessages, mergeBotMessages } from '../mergeMessages';
import {
  findMatchingWatchKeywordEntries,
  messageMatchesWatchKeyword,
  type WatchKeywordEntry,
} from '../platforms';
import type { BotCommand } from './types';

/**
 * Compact summary of a Chat SDK Message's attachments for debug logging.
 * Lets us trace exactly what the platform adapter handed us at the point
 * where the bot router receives it (before merge / extractFiles run).
 */
export const summarizeMessageAttachments = (message: Message): Array<Record<string, unknown>> => {
  const attachments = (message as any).attachments as
    | Array<{
        buffer?: Buffer;
        fetchData?: () => Promise<Buffer>;
        mimeType?: string;
        name?: string;
        size?: number;
        type?: string;
        url?: string;
      }>
    | undefined;
  if (!attachments?.length) return [];
  return attachments.map((att) => ({
    hasBuffer: !!att.buffer,
    hasFetchData: typeof att.fetchData === 'function',
    hasUrl: !!att.url,
    mimeType: att.mimeType,
    name: att.name,
    size: att.size,
    type: att.type,
  }));
};

/**
 * Merge messages skipped by the Chat SDK concurrency strategy (debounce/queue)
 * with the current message. Returns a single message with combined text and
 * attachments so the agent sees the full user intent.
 */
export function mergeSkippedMessages(message: Message, context?: { skipped?: Message[] }): Message {
  // context.skipped is chronological; current message is the latest
  return mergeBotMessages(message, context?.skipped);
}

/**
 * Whether the message, or a debounced message the same sender queued before it, contains one of
 * `keywords`. Inspecting the siblings lets a keyword queued behind a non-trigger still fire.
 */
export const burstMatchesWatchKeyword = (
  message: Message,
  skipped: Message[] | undefined,
  keywords: ReadonlyArray<string>,
): boolean =>
  keywords.length > 0 &&
  (messageMatchesWatchKeyword(message.text, keywords) ||
    getSameSenderMessages(message, skipped).some((m) =>
      messageMatchesWatchKeyword(m.text, keywords),
    ) === true);

/**
 * Prepend the operator-authored `instruction` of every matched watch
 * keyword to the merged user message. Used on the keyword-wake paths
 * (subscribed-thread `onSubscribedMessage` and the channel catch-all)
 * so a bare trigger like "bug" can carry a directive into the agent
 * call without an explicit mention.
 *
 * Duplicated instructions are de-duplicated (operators routinely paste
 * the same directive under several keywords like "bug" / "outage").
 * If no matched entry has an instruction, the original `merged` is
 * returned unchanged so the caller doesn't need to branch.
 */
export function applyWatchKeywordInstructions(
  merged: Message,
  entries: ReadonlyArray<WatchKeywordEntry>,
): { instructionCount: number; merged: Message; prefixLength: number } {
  const matched = findMatchingWatchKeywordEntries(merged.text, entries);
  const instructions = Array.from(
    new Set(
      matched.map((entry) => entry.instruction?.trim()).filter((value): value is string => !!value),
    ),
  );
  if (instructions.length === 0) {
    return { instructionCount: 0, merged, prefixLength: 0 };
  }
  const prefix = instructions.join('\n\n');
  const originalText = merged.text ?? '';
  const augmentedText = originalText ? `${prefix}\n\n${originalText}` : prefix;
  const next = Object.assign(Object.create(Object.getPrototypeOf(merged)), merged, {
    text: augmentedText,
  }) as Message;
  return { instructionCount: instructions.length, merged: next, prefixLength: prefix.length };
}

/**
 * Parse a text message for a registered command.
 * Handles formats: "/cmd", "/cmd args", "/cmd@botname args" (Telegram).
 * Returns the matched command and any trailing arguments, or null.
 */
export function dispatchTextCommand(
  text: string | undefined,
  commands: BotCommand[],
): { args: string; command: BotCommand } | null {
  if (!text) return null;
  const match = text.trim().match(/^\/(\w+)(?:@\w+)?(?:\s(.*))?$/s);
  if (!match) return null;
  const name = match[1].toLowerCase();
  const command = commands.find((c) => c.name === name);
  if (!command) return null;
  return { args: match[2]?.trim() ?? '', command };
}
