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
   * The running installation cannot update itself — a snap (snapd owns the
   * refresh), the plain `tar.gz` archive, or an AppImage started without its
   * runtime. The only way forward is downloading a new build manually.
   */
  | 'unsupported';

export interface UpdaterState {
  errorMessage?: string;
  progress?: ProgressInfo;
  stage: UpdaterStage;
  updateInfo?: UpdateInfo;
}
