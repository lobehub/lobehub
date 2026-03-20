import { App } from 'antd';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import {
  formatFileSize,
  type ImageConstraints,
  validateImageDimensions,
  validateImageFiles,
} from '../utils/imageValidation';

/**
 * File upload validation hook
 * Encapsulates file size, count, and dimension validation logic, provides user-friendly error messages
 */
export const useUploadFilesValidation = (
  maxCount?: number,
  maxFileSize?: number,
  imageConstraints?: ImageConstraints,
) => {
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

  const validateDimensions = useCallback(
    async (file: File): Promise<boolean> => {
      if (!imageConstraints) return true;

      try {
        const result = await validateImageDimensions(file, imageConstraints);
        if (!result.valid) {
          if (result.error === 'imageDimensionTooSmall') {
            const parts = [];
            if (result.minWidth) parts.push(`width ≥ ${result.minWidth}px`);
            if (result.minHeight) parts.push(`height ≥ ${result.minHeight}px`);

            message.error(
              t('ImageUpload.validation.imageDimensionTooSmall', {
                fileName: result.fileName || file.name,
                height: result.height,
                minDimension: parts.join(', '),
                width: result.width,
              }),
            );
          } else if (result.error === 'imageDimensionTooLarge') {
            const parts = [];
            if (result.maxWidth) parts.push(`width ≤ ${result.maxWidth}px`);
            if (result.maxHeight) parts.push(`height ≤ ${result.maxHeight}px`);

            message.error(
              t('ImageUpload.validation.imageDimensionTooLarge', {
                fileName: result.fileName || file.name,
                height: result.height,
                maxDimension: parts.join(', '),
                width: result.width,
              }),
            );
          } else if (result.error === 'imageAspectRatioInvalid') {
            const ratio =
              result.width && result.height ? (result.width / result.height).toFixed(2) : '?';
            const min = imageConstraints.aspectRatio?.min;
            const max = imageConstraints.aspectRatio?.max;
            const range = min && max ? `${min}–${max}` : min ? `≥ ${min}` : `≤ ${max}`;

            message.error(
              t('ImageUpload.validation.imageAspectRatioInvalid', {
                actualRatio: ratio,
                fileName: result.fileName || file.name,
                range,
              }),
            );
          }
          return false;
        }
      } catch {
        // If we can't read dimensions, allow upload to proceed
      }

      return true;
    },
    [imageConstraints, message, t],
  );

  return {
    validateDimensions,
    validateFiles,
  };
};
