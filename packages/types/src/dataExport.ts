/**
 * Stored in `async_tasks.metadata` of a `data_export` task once its file is ready.
 */
export interface DataExportTaskMetadata {
  /** Storage key of the export file, e.g. `exports/<userId>/<taskId>.json`. */
  fileKey?: string;
  /** Size of the export file in bytes. */
  fileSize?: number;
}

/**
 * - `processing`: queued or being built
 * - `success`: the file is ready to download
 * - `error`: the export failed or never finished
 */
export type DataExportStatus = 'error' | 'processing' | 'success';

/** The latest data export as shown on the storage settings page. */
export interface DataExportView {
  /** When the file finished building; only set on `success`. */
  completedAt?: Date;
  createdAt: Date;
  /** Size of the export file in bytes; only set on `success`. */
  fileSize?: number;
  id: string;
  status: DataExportStatus;
}
