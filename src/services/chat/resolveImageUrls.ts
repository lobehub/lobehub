import type { OpenAIChatMessage } from '@lobechat/types';

/** Replace local image proxy links before remote providers fetch through a WAF. */
export const resolveChatImageUrls = async (
  messages: OpenAIChatMessage[],
  origin: string,
  resolveReadableUrls: (ids: string[], signal?: AbortSignal) => Promise<Record<string, string>>,
  signal?: AbortSignal,
): Promise<OpenAIChatMessage[]> => {
  signal?.throwIfAborted();
  const imageIds = new Map<string, string>();
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type !== 'image_url') continue;
      let url: URL;
      try {
        url = new URL(part.image_url.url, origin);
      } catch {
        continue;
      }
      const match = /^\/f\/([^/]+)$/.exec(url.pathname);
      if (url.origin === origin && match) imageIds.set(part.image_url.url, match[1]);
    }
  }
  if (imageIds.size === 0) return messages;

  // Resolve once per request so later turns receive fresh signatures.
  const urls = await resolveReadableUrls([...new Set(imageIds.values())], signal);
  signal?.throwIfAborted();
  return messages.map((message) => {
    if (!Array.isArray(message.content)) return message;
    const content = message.content.map((part) => {
      if (part.type !== 'image_url') return part;
      const id = imageIds.get(part.image_url.url);
      if (!id) return part;
      const url = urls[id];
      // Never fall back to a protected proxy after a failed or incomplete lookup.
      if (!url) throw new Error('Missing readable URL');
      return { ...part, image_url: { ...part.image_url, url } };
    });
    return { ...message, content };
  });
};
