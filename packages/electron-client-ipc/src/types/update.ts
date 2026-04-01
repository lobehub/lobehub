export type UpdateChannel = 'stable' | 'canary';

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

export type UpdaterStage = 'idle' | 'checking' | 'downloading' | 'downloaded' | 'latest' | 'error';

export interface UpdaterState {
  errorMessage?: string;
  progress?: ProgressInfo;
  stage: UpdaterStage;
  updateInfo?: UpdateInfo;
}
