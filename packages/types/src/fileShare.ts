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

/** What a share link visitor reads: the file and short-lived addresses to its bytes. */
export interface SharedFileData {
  file: {
    /** Address that downloads the bytes under the file's own name. */
    downloadUrl: string;
    fileType: string;
    id: string;
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
