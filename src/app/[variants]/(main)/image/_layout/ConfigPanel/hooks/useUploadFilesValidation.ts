import { App } from 'antd';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { formatFileSize, validateImageFiles } from '../utils/imageValidation';

/**
 * File upload validation hook
 * Encapsulates file size and count validation logic, provides user-friendly error messages
 */
export const useUploadFilesValidation = (maxCount?: number, maxFileSize?: number) => {
  const { t } = useTranslation('components');
  const { message } = App.useApp();

  const validateFiles = useCallback(
    (files: File[], currentCount: number = 0): boolean => {
      const validationResult = validateImageFiles(files, {
        maxAddedFiles: maxCount ? maxCount - currentCount : undefined,
        maxFileSize,
      });

      if (!validationResult.valid) {
        // Display user-friendly error messages
        validationResult.errors.forEach((error) => {
          if (error === 'fileSizeExceeded') {
            // Collect all failed files info
            const fileSizeFailures =
              validationResult.failedFiles?.filter(
                (failedFile) =>
                  failedFile.error === 'fileSizeExceeded' &&
                  failedFile.actualSize &&
                  failedFile.maxSize,
              ) || [];

            if (fileSizeFailures.length === 1) {
              // Single file error - show detailed message
              const failedFile = fileSizeFailures[0];
              const actualSizeStr = formatFileSize(failedFile.actualSize!);
              const maxSizeStr = formatFileSize(failedFile.maxSize!);
              const fileName = failedFile.fileName || 'File';
              message.error(
                t('MultiImagesUpload.validation.fileSizeExceededDetail', {
                  actualSize: actualSizeStr,
                  fileName,
                  maxSize: maxSizeStr,
                }),
              );
            } else if (fileSizeFailures.length > 1) {
              // Multiple files error - show summary message
              const maxSizeStr = formatFileSize(fileSizeFailures[0].maxSize!);
              const fileList = fileSizeFailures
                .map((f) => `${f.fileName || 'File'} (${formatFileSize(f.actualSize!)})`)
                .join(', ');
              message.error(
                t('MultiImagesUpload.validation.fileSizeExceededMultiple', {
                  count: fileSizeFailures.length,
                  fileList,
                  maxSize: maxSizeStr,
                }),
              );
            }
          } else if (error === 'imageCountExceeded') {
            message.error(t('MultiImagesUpload.validation.imageCountExceeded'));
          }
        });
        return false;
      }

      return true;
    },
    [maxCount, maxFileSize, message, t],
  );

  return {
    validateFiles,
  };
};
