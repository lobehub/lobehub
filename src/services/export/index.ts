import { type ExportDatabaseData } from '@/types/export';

import { lambdaClient } from '@/libs/trpc/client';

class ExportService {
  exportData = async (): Promise<ExportDatabaseData> => {
    return await lambdaClient.exporter.exportData.mutate();
  };
}

export const exportService = new ExportService();
