import { type DataExportView } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class ExportService {
  getExportDownloadUrl = async (id: string): Promise<{ fileName: string; url: string }> =>
    lambdaClient.exporter.getExportDownloadUrl.mutate({ id });

  getLatestExport = async (): Promise<DataExportView | null> =>
    lambdaClient.exporter.getLatestExport.query();

  startExport = async (): Promise<DataExportView> => lambdaClient.exporter.startExport.mutate();
}

export const exportService = new ExportService();
