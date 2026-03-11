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

export interface FormatDiscordContextOptions {
  channel?: DiscordChannelInfo;
  guild?: DiscordGuildInfo;
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
 * // </discord_context>
 * ```
 */
export const formatDiscordContext = ({ guild, channel }: FormatDiscordContextOptions): string => {
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

  return `<discord_context>\n${parts.join('\n')}\n</discord_context>`;
};
