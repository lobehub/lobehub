/**
 * The web link that opens the judged message on its platform, from the address the signal kept
 * (`signals.metadata.address`, which outlives the payload purge).
 *
 * Returns:
 * - Discord: `https://discord.com/channels/<guild | @me>/<thread | channel>/<message>`; a message
 *   in a thread opens in the thread
 * - `undefined` for other platforms (no stable web link) and for an incomplete address
 */
export const platformMessageUrl = (
  address: Record<string, string> | null | undefined,
): string | undefined => {
  if (!address?.messageId || !address.platformThreadId) return undefined;

  if (address.platform === 'discord') {
    const [prefix, guildId, channelId, threadId] = address.platformThreadId.split(':');
    if (prefix !== 'discord' || !guildId || !channelId) return undefined;

    return `https://discord.com/channels/${guildId}/${threadId || channelId}/${address.messageId}`;
  }

  return undefined;
};
