/**
 * Owner-controlled settings for a file share link (e.g. whether the page offers a download).
 * Stored as jsonb, so adding a control needs no migration; unset keys fall back to defaults.
 */
export type FileShareConfig = Record<string, unknown>;

/** `'private'` = owner only, `'link'` = anyone with the link (see `ShareVisibility`). */
export type FileShareVisibility = 'private' | 'link';

/** The owner's view of a file's share link. */
export interface FileShareSettings {
  fileId: string;
  pageViewCount: number;
  /** The share link id: `/share/file/<shareId>`. */
  shareId: string;
  visibility: FileShareVisibility;
}

/**
 * What a share link visitor reads: the file and addresses to its bytes.
 *
 * The addresses are scoped to the SHARE and re-check it on every request, so
 * making the share private cuts off a page already open. They must also outlive
 * the page — it reads the share once (each read counts a view), so a signed URL
 * that expires would break a later download or a resumed video. The file's own
 * id is deliberately absent: the `/f/:fileId` proxy is public by id and would
 * outlive the share.
 */
export interface SharedFileData {
  file: {
    /** Address that downloads the bytes under the file's own name. */
    downloadUrl: string;
    fileType: string;
    name: string;
    /** Address the viewer renders from. */
    previewUrl: string;
    size: number;
  };
  isOwner: boolean;
  ownerMeta: { avatar: string | null; displayName: string | null };
  pageViewCount: number;
  shareId: string;
}
