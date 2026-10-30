export interface DiscordGuildInfo {
  id: string;
  name?: string;
}

export interface DiscordChannelInfo {
  id: string;
  name?: string;
  topic?: string;
  type?: number;
}

export interface DiscordThreadInfo {
  id: string;
  name?: string;
}

/**
 * Discord only notifies a user for the `<@id>` token; a typed `@Name` renders
 * as plain text. Inbound mentions reach the model as `@Name (<@id>)` (see the
 * bot's `resolveDiscordMentions`), so it has the id to copy back.
 */
const MENTION_SYNTAX =
  '  <mention_syntax>To @-mention (notify) someone, write <@USER_ID> with their numeric Discord user id. A plain "@Name" is only text and notifies nobody. Mentions in incoming messages appear as "@Name (<@USER_ID>)": copy the <@USER_ID> part; the id of whoever wrote a message is the `id` on their <speaker> tag. Never invent an id; if you do not know it, write the name without "@".</mention_syntax>';

export interface FormatDiscordContextOptions {
  channel?: DiscordChannelInfo;
  guild?: DiscordGuildInfo;
  thread?: DiscordThreadInfo;
}

/**
 * Format Discord context into XML for system injection message.
 *
 * @example
 * ```typescript
 * const xml = formatDiscordContext({
 *   guild: { id: '123456', name: 'My Server' },
 *   channel: { id: '789', name: 'general', type: 0, topic: 'General discussion' },
 * });
 * // Returns:
 * // <discord_context>
 * //   <guild id="123456" name="My Server" />
 * //   <channel id="789" name="general" type="0" topic="General discussion" />
 * //   <mention_syntax>...</mention_syntax>
 * // </discord_context>
 * ```
 */
export const formatDiscordContext = ({
  guild,
  channel,
  thread,
}: FormatDiscordContextOptions): string => {
  const parts: string[] = [];

  if (guild) {
    const attrs = [`id="${guild.id}"`];
    if (guild.name) attrs.push(`name="${guild.name}"`);
    parts.push(`  <guild ${attrs.join(' ')} />`);
  }

  if (channel) {
    const attrs = [`id="${channel.id}"`];
    if (channel.name) attrs.push(`name="${channel.name}"`);
    if (channel.type !== undefined) attrs.push(`type="${channel.type}"`);
    if (channel.topic) attrs.push(`topic="${channel.topic}"`);
    parts.push(`  <channel ${attrs.join(' ')} />`);
  }

  if (thread) {
    const attrs = [`id="${thread.id}"`];
    if (thread.name) attrs.push(`name="${thread.name}"`);
    parts.push(`  <thread ${attrs.join(' ')} />`);
  }

  parts.push(MENTION_SYNTAX);

  return `<discord_context>\n${parts.join('\n')}\n</discord_context>`;
};
