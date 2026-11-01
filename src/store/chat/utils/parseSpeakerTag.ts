import type { BotSenderMetadata } from '@lobechat/types';

/**
 * Matches the IM-bot speaker tag at the start of a user message:
 * `<speaker id="…" username="…" nickname="…" avatar="…" />`.
 * Group-chat tags (`<speaker name="…" />`) carry no `id` and are ignored.
 */
const SPEAKER_TAG_REGEX = /^<speaker\s([^>]*)\/>/;
const ATTR_REGEX = /(\w+)="([^"]*)"/g;

const DISCORD_CDN = 'https://cdn.discordapp.com';

/**
 * Recover the bot-channel sender from the `<speaker>` tag that older inbound
 * bot messages carry in their content (rows written before
 * `metadata.botSender` existed). Returns `undefined` for any other content.
 *
 * The tag has no platform attribute; a bare avatar hash is only ever produced
 * by Discord (`raw.author.avatar`), so it is resolved against the Discord CDN.
 */
export const parseSpeakerTag = (content?: string | null): BotSenderMetadata | undefined => {
  if (!content) return undefined;
  const match = SPEAKER_TAG_REGEX.exec(content);
  if (!match) return undefined;

  const attrs: Record<string, string> = {};
  for (const [, key, value] of match[1].matchAll(ATTR_REGEX)) attrs[key] = value;
  if (!attrs.id) return undefined;

  const isUrl = /^https?:\/\//.test(attrs.avatar ?? '');
  const avatar = !attrs.avatar
    ? undefined
    : isUrl
      ? attrs.avatar
      : `${DISCORD_CDN}/avatars/${attrs.id}/${attrs.avatar}.${attrs.avatar.startsWith('a_') ? 'gif' : 'png'}`;

  return {
    avatar,
    fullName: attrs.nickname || undefined,
    id: attrs.id,
    platform: isUrl || !attrs.avatar ? 'unknown' : 'discord',
    username: attrs.username && attrs.username !== attrs.nickname ? attrs.username : undefined,
  };
};
