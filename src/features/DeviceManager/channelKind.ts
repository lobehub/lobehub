export type ChannelKind = 'cli' | 'desktop';

/**
 * Which client holds a gateway connection. Channels carry a suffix for variants
 * of the same client (`desktop-dev`), so match on the prefix.
 */
export const getChannelKind = (channel: string | null | undefined): ChannelKind | undefined => {
  if (!channel) return undefined;
  for (const kind of ['desktop', 'cli'] as const) {
    if (channel === kind || channel.startsWith(`${kind}-`)) return kind;
  }
  return undefined;
};

/** The metadata key each client reports its own version under on register. */
const VERSION_KEY: Record<ChannelKind, string> = {
  cli: 'cliVersion',
  desktop: 'appVersion',
};

/**
 * The version a connection's client runs. The desktop app's live answer beats
 * the registry, which only holds what it reported on its last connect.
 */
export const getChannelVersion = (
  kind: ChannelKind | undefined,
  metadata: Record<string, string> | null | undefined,
  liveDesktopVersion?: string,
): string | undefined => {
  if (!kind) return undefined;
  if (kind === 'desktop' && liveDesktopVersion) return liveDesktopVersion;
  return metadata?.[VERSION_KEY[kind]] || undefined;
};
