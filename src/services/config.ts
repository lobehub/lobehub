import { BRANDING_NAME } from '@lobechat/business-const';
import { downloadFile, exportJSONFile } from '@lobechat/utils/client';
import dayjs from 'dayjs';

import { getCacheScope } from '@/libs/swr/useCacheScope';
import { type ImportPgDataStructure } from '@/types/export';

import { exportService } from './export';

class ConfigService {
  /** Running exports, keyed by the user and workspace scope they read. */
  private exportAllTasks = new Map<string, Promise<void>>();

  /**
   * Exports all data of the current account or workspace as one file.
   *
   * Calls made while an export of the same scope is still running share it instead of starting
   * another one: each export reads every message of the scope on the server and can take tens of
   * seconds, and repeated clicks used to start one full read each. The scope is part of the key
   * because switching workspaces does not reload the page, and the server exports the active one.
   */
  exportAll = (): Promise<void> => {
    const scope = getCacheScope();
    const running = this.exportAllTasks.get(scope);
    if (running) return running;

    const task = this.runExportAll().finally(() => {
      this.exportAllTasks.delete(scope);
    });
    this.exportAllTasks.set(scope, task);

    return task;
  };

  private runExportAll = async () => {
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
