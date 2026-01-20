export interface ReleaseNoteInfo {
  /**
   * The note.
   */
  note: string | null;
  /**
   * The version.
   */
  version: string;
}

export interface ProgressInfo {
  bytesPerSecond: number;
  percent: number;
  total: number;
  transferred: number;
}

export interface UpdateInfo {
  releaseDate: string;
  releaseNotes?: string | ReleaseNoteInfo[];
  version: string;
}

/**
 * Default value for auto check update setting.
 * Centralized here to ensure consistency between main process and renderer.
 */
export const DEFAULT_AUTO_CHECK_UPDATE = true;
