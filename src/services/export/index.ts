import { lambdaClient } from '@/libs/trpc/client';
import { type ExportDatabaseData } from '@/types/export';

class ExportService {
  exportData = async (): Promise<ExportDatabaseData> => {
    return await lambdaClient.exporter.exportData.mutate();
  };
}

export const exportService = new ExportService();
