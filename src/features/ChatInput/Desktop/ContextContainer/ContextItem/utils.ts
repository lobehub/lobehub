import type { UploadFileItem } from '@/types/files/upload';
import { formatSize } from '@/utils/format';

export const getFileBasename = (filename: string): string => {
  const lastDotIndex = filename.lastIndexOf('.');
  if (lastDotIndex <= 0) return filename;
  return filename.slice(0, lastDotIndex);
};

export const getHarmoniousSize = (
  inputWidth: number,
  inputHeight: number,
  {
    spacing = 24,
    containerWidth,
    containerHeight,
  }: { containerHeight: number; containerWidth: number; spacing: number },
) => {
  let width = String(inputWidth);
  let height = String(inputHeight);

  const maxWidth = containerWidth - spacing;
  const maxHeight = containerHeight - spacing;

  if (inputHeight >= inputWidth && inputHeight >= maxHeight) {
    height = maxHeight + 'px';
    width = 'auto';
  } else if (inputWidth >= inputHeight && inputWidth >= maxWidth) {
    height = 'auto';
    width = maxWidth + 'px';
  } else {
    width = width + 'px';
    height = height + 'px';
  }

  return { height, width };
};

/** Keep upload feedback and available actions consistent throughout the chip lifecycle. */
export const getUploadChipState = ({
  status,
  uploadState,
}: Pick<UploadFileItem, 'status' | 'uploadState'>) => {
  const busy = status === 'pending' || status === 'uploading' || status === 'processing';
  const rawProgress = uploadState?.progress;
  const progress =
    typeof rawProgress === 'number' && Number.isFinite(rawProgress)
      ? Math.min(100, Math.max(0, rawProgress))
      : undefined;

  return {
    busy,
    canPreview: status === 'success',
    canRetry: status === 'error' || status === 'cancelled',
    indicator:
      status === 'error' || status === 'cancelled'
        ? 'error'
        : status === 'uploading' && progress !== undefined
          ? 'progress'
          : busy
            ? 'loading'
            : 'file',
    progress,
  };
};

/** Express transferred and total bytes in the same unit so the ratio is easy to compare. */
export const getUploadChipSize = ({
  file,
  status,
  uploadState,
}: Pick<UploadFileItem, 'file' | 'status' | 'uploadState'>) => {
  if (status === 'success') return undefined;

  const total = formatSize(file.size);
  if (status !== 'pending' && status !== 'uploading') return total;

  const { progress } = getUploadChipState({ status, uploadState });
  if (status === 'uploading' && progress === undefined) return `—/${total}`;

  const unit = total.split(' ')[1];
  const divisor = unit === 'GB' ? 1024 ** 3 : unit === 'MB' ? 1024 ** 2 : 1024;
  const transferred = (
    (file.size * (status === 'pending' ? 0 : progress!)) /
    100 /
    divisor
  ).toFixed(1);
  return `${transferred}/${total}`;
};
