import { type DefaultErrorShape } from '@trpc/server/unstable-core-do-not-import';

import { lambdaClient } from '@/libs/trpc/client';
import { uploadService } from '@/services/upload';
import { useUserStore } from '@/store/user';
import { type ImportPgDataStructure } from '@/types/export';
import { type ImporterEntryData, type OnImportCallbacks } from '@/types/importer';
import { ImportStage } from '@/types/importer';
import { type UserSettings } from '@/types/user/settings';
import { uuid } from '@/utils/uuid';

class ImportService {
  importSettings = async (settings: UserSettings): Promise<void> => {
    await useUserStore.getState().importAppSettings(settings);
  };

  private createErrorHandler = (callbacks?: OnImportCallbacks) => (e: unknown) => {
    callbacks?.onStageChange?.(ImportStage.Error);
    const error = typeof e === 'object' && e !== null ? (e as any) : {};
    const message = typeof e === 'string' ? e : error?.message || 'Import failed';
    const code = error?.data?.code || error?.code || (typeof e === 'string' ? e : 'IMPORT_FAILED');

    callbacks?.onError?.({
      code,
      httpStatus: error?.data?.httpStatus || error?.httpStatus || 500,
      message,
      path: error?.data?.path || error?.path,
    });
  };

  private handleResult = (
    result: any,
    time: number,
    callbacks?: OnImportCallbacks,
    handleError?: (e: unknown) => void,
  ) => {
    if (result && 'success' in result && !result.success) {
      handleError?.(result.error);
      return;
    }

    const duration = Date.now() - time;
    callbacks?.onStageChange?.(ImportStage.Success);
    callbacks?.onSuccess?.(result.results, duration);
  };

  importData = async (data: ImporterEntryData, callbacks?: OnImportCallbacks): Promise<void> => {
    const handleError = this.createErrorHandler(callbacks);

    const totalLength =
      (data.messages?.length || 0) +
      (data.sessionGroups?.length || 0) +
      (data.sessions?.length || 0) +
      (data.topics?.length || 0);

    if (totalLength < 500) {
      callbacks?.onStageChange?.(ImportStage.Importing);
      const time = Date.now();
      try {
        const result = await lambdaClient.importer.importByPost.mutate({ data });
        this.handleResult(result, time, callbacks, handleError);
      } catch (e) {
        handleError(e);
      }

      return;
    }

    await this.uploadData(data, { callbacks, handleError });
  };

  importPgData = async (
    data: ImportPgDataStructure,
    options?: {
      callbacks?: OnImportCallbacks;
      overwriteExisting?: boolean;
    },
  ): Promise<void> => {
    const { callbacks } = options || {};
    const handleError = this.createErrorHandler(callbacks);

    const totalLength = Object.values(data.data)
      .map((d) => d.length)
      .reduce((a, b) => a + b, 0);

    if (totalLength < 500) {
      callbacks?.onStageChange?.(ImportStage.Importing);
      const time = Date.now();
      try {
        const result = await lambdaClient.importer.importPgByPost.mutate(data);
        this.handleResult(result, time, callbacks, handleError);
      } catch (e) {
        handleError(e);
      }

      return;
    }

    await this.uploadData(data, { callbacks, handleError });
  };

  private uploadData = async (
    data: object,
    { callbacks, handleError }: { callbacks?: OnImportCallbacks; handleError: (e: unknown) => any },
  ) => {
    // if the data is too large, upload it to S3 and upload by file
    const filename = `${uuid()}.json`;

    let pathname;
    try {
      callbacks?.onStageChange?.(ImportStage.Uploading);
      const result = await uploadService.uploadDataToS3(data, {
        filename,
        onProgress: (status, state) => {
          callbacks?.onFileUploading?.(state);
        },
        pathname: `import_config/${filename}`,
      });
      pathname = result.data.path;
    } catch (e) {
      handleError(e);
      throw new Error('Upload Error');
    }

    callbacks?.onStageChange?.(ImportStage.Importing);
    const time = Date.now();
    try {
      const result = await lambdaClient.importer.importByFile.mutate({ pathname });
      this.handleResult(result, time, callbacks, handleError);
    } catch (e) {
      handleError(e);
    }
  };
}

export const importService = new ImportService();
