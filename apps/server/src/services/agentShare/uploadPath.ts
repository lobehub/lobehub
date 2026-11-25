/**
 * Storage key prefix for a share's visitor uploads, under the CREATOR's file
 * namespace. The prefix is what ties an upload session / file row back to a
 * specific share on the settle and abort paths: a visitor can only complete or
 * release reservations that live under their share's prefix, never one of the
 * creator's own uploads.
 */
export const shareUploadPrefix = (share: {
  ownerId: string;
  shareId: string;
  workspaceId: string | null;
}) =>
  share.workspaceId
    ? `files/workspaces/${share.workspaceId}/agent-share/${share.shareId}/`
    : `files/${share.ownerId}/agent-share/${share.shareId}/`;

/** Basename only — a visitor-supplied name must not steer the storage key. */
export const sanitizeShareUploadName = (name: string) =>
  name
    .replaceAll(/[/\\]/g, '_')
    .replaceAll(/\p{Cc}/gu, '')
    .trim() || 'file';
