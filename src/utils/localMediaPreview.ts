/**
 * Session-scoped map from an uploaded file id to the local object URL created
 * when the user attached it.
 *
 * The chat input already holds every attached image/video in memory as a blob
 * URL. Once the message is sent, the server echoes the same file back with a
 * remote (often presigned) URL, which forces the browser to download the image
 * again and paints it slowly. Rendering through this map keeps the bytes the
 * user just attached on screen for the rest of the session; a reload clears
 * the map and falls back to the remote URL.
 */
const localPreviewUrls = new Map<string, string>();

const isLocalUrl = (url: string) => url.startsWith('blob:') || url.startsWith('data:');

/**
 * Remember a local preview for a file id. Only in-memory `blob:` / `data:` URLs
 * qualify; a remote URL would bring back the slow download this map avoids.
 */
export const rememberLocalMediaPreview = (fileId: string, url?: string) => {
  if (!fileId || !url || !isLocalUrl(url)) return;

  localPreviewUrls.set(fileId, url);
};

/**
 * Prefer the local preview for an item whose file was attached in this session.
 * Returns the same array when nothing changes so memoized children keep their props.
 */
export const withLocalMediaPreview = <T extends { id: string; url: string }>(items: T[]): T[] => {
  if (localPreviewUrls.size === 0) return items;

  let changed = false;
  const next = items.map((item) => {
    const localUrl = localPreviewUrls.get(item.id);
    if (!localUrl || localUrl === item.url) return item;

    changed = true;
    return { ...item, url: localUrl };
  });

  return changed ? next : items;
};

/** Test-only reset. */
export const clearLocalMediaPreviews = () => localPreviewUrls.clear();
