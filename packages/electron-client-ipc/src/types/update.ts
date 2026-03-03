export type UpdateChannel = 'stable' | 'nightly' | 'canary';

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
