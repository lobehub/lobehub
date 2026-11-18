/**
 * postMessage protocol between the embed loader (on the host website) and the
 * embedded conversation (`/embed/agent/:slug`, inside the iframe).
 *
 * Every message carries `source` and `version`, so either side can ignore
 * unrelated traffic (other widgets, browser extensions) on the same window.
 *
 * Handshake: the loader posts `init` once the iframe loads. The iframe records
 * that event's origin as its host and answers `ready` — every later message to
 * the host is posted to that origin only, never to `*`. The browser has already
 * refused to render the iframe under any origin outside the share's allowlist
 * (`frame-ancestors`), so a host that can talk to the iframe is an allowed one.
 */

export const EMBED_MESSAGE_SOURCE = 'lobehub-embed';
export const EMBED_PROTOCOL_VERSION = 1;

/** `auto` follows the visitor's system color scheme. */
export type EmbedTheme = 'auto' | 'dark' | 'light';

export const EMBED_THEMES: readonly EmbedTheme[] = ['auto', 'dark', 'light'];

export const isEmbedTheme = (value: unknown): value is EmbedTheme =>
  typeof value === 'string' && (EMBED_THEMES as readonly string[]).includes(value);

/** Host website → embedded conversation. */
export type HostToEmbedMessage =
  { theme?: EmbedTheme; type: 'init' } | { theme: EmbedTheme; type: 'setTheme' };

/** Embedded conversation → host website. */
export type EmbedToHostMessage =
  | { type: 'ready' }
  /** The visitor pressed the panel's close button. */
  | { type: 'close' }
  /** The visitor sent a message. Carries no content: the host only learns that it happened. */
  | { topicId?: string; type: 'messageSent' }
  /** The visitor's first message opened a new conversation. */
  | { topicId: string; type: 'topicCreated' };

export type EmbedEnvelope<T> = T & { source: typeof EMBED_MESSAGE_SOURCE; version: number };

export const wrapEmbedMessage = <T extends { type: string }>(message: T): EmbedEnvelope<T> => ({
  ...message,
  source: EMBED_MESSAGE_SOURCE,
  version: EMBED_PROTOCOL_VERSION,
});

const isEnvelope = (data: unknown): data is EmbedEnvelope<{ type: string }> =>
  !!data &&
  typeof data === 'object' &&
  (data as { source?: unknown }).source === EMBED_MESSAGE_SOURCE &&
  typeof (data as { type?: unknown }).type === 'string';

/** Narrow an incoming `message` event payload to a host → embed message. */
export const readHostMessage = (data: unknown): HostToEmbedMessage | null => {
  if (!isEnvelope(data)) return null;

  const { theme, type } = data as { theme?: unknown; type: string };
  if (type === 'init') return isEmbedTheme(theme) ? { theme, type } : { type };
  if (type === 'setTheme' && isEmbedTheme(theme)) return { theme, type };

  return null;
};

/** Narrow an incoming `message` event payload to an embed → host message. */
export const readEmbedMessage = (data: unknown): EmbedToHostMessage | null => {
  if (!isEnvelope(data)) return null;

  const { topicId, type } = data as { topicId?: unknown; type: string };
  switch (type) {
    case 'ready':
    case 'close': {
      return { type };
    }
    case 'messageSent': {
      return typeof topicId === 'string' ? { topicId, type } : { type };
    }
    case 'topicCreated': {
      return typeof topicId === 'string' ? { topicId, type } : null;
    }
    default: {
      return null;
    }
  }
};

/** Path of the embedded conversation for a share slug (or share id). */
export const buildEmbedPath = (slugOrId: string) => `/embed/agent/${encodeURIComponent(slugOrId)}`;
