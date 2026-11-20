export interface DataExportResultParams {
  status: 'error' | 'success';
  taskId: string;
  userId: string;
  workspaceId?: string;
}

/** Tell the user who started a data export that it finished or failed. */
export const notifyDataExportResult = (_params: DataExportResultParams): Promise<void> =>
  Promise.resolve();
