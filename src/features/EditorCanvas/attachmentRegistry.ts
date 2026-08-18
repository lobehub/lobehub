/**
 * URL → fileId registry for editor attachments.
 *
 * The editor plugins (`ReactImagePlugin` / `ReactFilePlugin`) expose a
 * `handleUpload(file) → { url }` contract that drops the fileId our upload
 * service returns. We persist the mapping here so callers can walk the editor
 * state on save and recover fileIds to send to the backend.
 *
 * Session-scoped. After a page reload the map is empty; callers hydrating an
 * existing editor must `seedAttachments(...)` from persisted file metadata.
 */

export interface RegisteredAttachment {
  downloadUrl?: string;
  fileId: string;
}

const urlToAttachment = new Map<string, RegisteredAttachment>();

const getUrlKeys = (url: string): string[] => {
  const keys = [url];

  try {
    const normalizedUrl = new URL(url);
    normalizedUrl.hash = '';
    normalizedUrl.search = '';
    const normalized = normalizedUrl.toString();
    if (normalized !== url) keys.push(normalized);
  } catch {
    const normalized = url.split(/[?#]/, 1)[0];
    if (normalized && normalized !== url) keys.push(normalized);
  }

  return keys;
};

export const registerAttachment = (url: string, fileId: string, downloadUrl?: string): void => {
  if (!url) return;

  const attachment = { downloadUrl, fileId } satisfies RegisteredAttachment;
  for (const key of getUrlKeys(url)) urlToAttachment.set(key, attachment);
};

export const getRegisteredAttachment = (
  url: string | undefined,
): RegisteredAttachment | undefined => {
  if (!url) return undefined;

  for (const key of getUrlKeys(url)) {
    const attachment = urlToAttachment.get(key);
    if (attachment) return attachment;
  }

  return undefined;
};

export const getFileIdForUrl = (url: string | undefined): string | undefined => {
  return getRegisteredAttachment(url)?.fileId;
};

export const seedAttachments = (
  items: Array<{ downloadUrl?: string; id: string; url: string }>,
): void => {
  for (const item of items) {
    if (item?.url && item?.id) registerAttachment(item.url, item.id, item.downloadUrl);
  }
};
