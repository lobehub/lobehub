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

const urlToFileId = new Map<string, string>();

export const registerAttachment = (url: string, fileId: string): void => {
  if (!url) return;
  urlToFileId.set(url, fileId);
};

export const getFileIdForUrl = (url: string | undefined): string | undefined => {
  if (!url) return undefined;
  return urlToFileId.get(url);
};

export const seedAttachments = (items: Array<{ id: string; url: string }>): void => {
  for (const item of items) {
    if (item?.url && item?.id) urlToFileId.set(item.url, item.id);
  }
};
