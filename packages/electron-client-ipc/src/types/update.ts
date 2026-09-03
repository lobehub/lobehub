export type UpdateChannel = 'stable' | 'canary';
export type UpdateKind = 'app' | 'renderer';

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
  kind: UpdateKind;
  releaseDate?: string;
  releaseNotes?: string | ReleaseNoteInfo[];
  version: string;
}

export type UpdaterStage =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'downloaded'
  | 'latest'
  | 'error'
  /**
   * This build ships no update feed, so there is nothing to check against.
   * Distinct from 'idle' (ready to check) and from 'error' (a check that
   * failed): the UI should offer no update affordance at all rather than a
   * button that can only ever fail.
   */
  | 'disabled';

export interface UpdaterState {
  errorMessage?: string;
  progress?: ProgressInfo;
  stage: UpdaterStage;
  updateInfo?: UpdateInfo;
}
