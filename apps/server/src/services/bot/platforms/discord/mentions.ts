import type { Message } from 'chat';

import { getSourceMessages } from '../../mergeMessages';

/**
 * Subset of a Discord `User` object as it appears in `MESSAGE_CREATE.mentions`
 * (and in `referenced_message.mentions` / `message_snapshots[].message.mentions`).
 * `member` is only present for guild messages and carries the server nickname.
 */
interface DiscordMentionUser {
  global_name?: string | null;
  id: string;
  member?: { nick?: string | null } | null;
  username?: string;
}

/** `<@123>` and the legacy nickname form `<@!123>`; role (`<@&`) and channel (`<#`) tokens are excluded. */
const USER_MENTION_RE = /<@!?(\d+)>/g;

const displayNameOf = (user: DiscordMentionUser): string | undefined =>
  user.member?.nick || user.global_name || user.username || undefined;

const pushMentions = (names: Map<string, string>, list: unknown) => {
  if (!Array.isArray(list)) return;
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const user = entry as DiscordMentionUser;
    if (typeof user.id !== 'string') continue;
    const name = displayNameOf(user);
    if (name && !names.has(user.id)) names.set(user.id, name);
  }
};

/**
 * Build an `id → display name` map from every Discord payload behind `message`:
 * its own `raw.mentions`, the quoted `referenced_message.mentions`, forwarded
 * `message_snapshots`, and — when the message was produced by
 * `mergeBotMessages` — the same fields on each merged source.
 *
 * Only the webhook-forwarded path carries a full payload; the Gateway path's
 * minimal `raw` yields an empty map, which callers must tolerate.
 */
export const collectDiscordMentionNames = (message?: unknown): Map<string, string> => {
  const names = new Map<string, string>();
  if (!message || typeof message !== 'object') return names;

  for (const source of getSourceMessages(message as Message)) {
    const raw = (source as { raw?: unknown }).raw as Record<string, any> | undefined;
    if (!raw || typeof raw !== 'object') continue;
    pushMentions(names, raw.mentions);
    pushMentions(names, raw.referenced_message?.mentions);
    if (Array.isArray(raw.message_snapshots)) {
      for (const snapshot of raw.message_snapshots)
        pushMentions(names, snapshot?.message?.mentions);
    }
  }

  return names;
};

/**
 * Rewrite `<@id>` tokens to `@Display Name` so the model reads who was
 * addressed instead of an opaque snowflake. Unknown ids are left untouched
 * rather than dropped — a raw id still tells the model *someone* was tagged.
 */
export const resolveDiscordMentions = (text: string, names: Map<string, string>): string =>
  text.replaceAll(USER_MENTION_RE, (token, id: string) => {
    const name = names.get(id);
    return name ? `@${name}` : token;
  });

/**
 * Drop the bot's own mention(s) when they *prefix* the message. That prefix is
 * how users address the bot (`@Bot /new`, `@Bot hello`) and carries no meaning
 * beyond "this is for you", so removing it keeps `/command` dispatch working.
 * A self mention anywhere else is content ("I built @Bot to replace you") and
 * is preserved for `resolveDiscordMentions` to name.
 */
export const stripLeadingBotMention = (text: string, applicationId: string): string =>
  text.replace(new RegExp(`^(?:\\s*<@!?${applicationId}>)+\\s*`), '');

/**
 * Full inbound-text normalization for Discord (see LOBE-14154):
 * 1. strip the leading self-mention prefix;
 * 2. resolve every remaining user mention to `@name` via the message payload;
 * 3. drop self mentions that could not be named (Gateway path, no `mentions`)
 *    so the model never sees its own raw id.
 */
export const sanitizeDiscordUserInput = (
  text: string,
  applicationId: string,
  message?: unknown,
): string => {
  const stripped = stripLeadingBotMention(text, applicationId);
  const resolved = resolveDiscordMentions(stripped, collectDiscordMentionNames(message));
  return resolved.replaceAll(new RegExp(`\\s*<@!?${applicationId}>`, 'g'), '').trim();
};
