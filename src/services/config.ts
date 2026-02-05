import { BRANDING_NAME } from '@lobechat/business-const';
import { downloadFile, exportJSONFile } from '@lobechat/utils/client';
import dayjs from 'dayjs';

import type {ImportPgDataStructure} from '@/types/export';

import { exportService } from './export';

class ConfigService {
  exportAll = async () => {
    const { data, url, schemaHash } = await exportService.exportData();
    const filename = `${dayjs().format('YYYY-MM-DD-hh-mm')}_${BRANDING_NAME}-data.json`;

    // if url exists, means export data from server and upload the data to S3
    // just need to download the file
    if (url) {
      await downloadFile(url, filename);
      return;
    }

    const result: ImportPgDataStructure = { data, mode: 'postgres', schemaHash };

    exportJSONFile(result, filename);
  };
}

export const configService = new ConfigService();
