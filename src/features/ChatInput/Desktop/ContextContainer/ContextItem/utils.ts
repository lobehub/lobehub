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
  retryable,
  status,
  uploadState,
}: Pick<UploadFileItem, 'retryable' | 'status' | 'uploadState'>) => {
  const busy = status === 'pending' || status === 'uploading' || status === 'processing';
  const rawProgress = uploadState?.progress;
  const progress =
    typeof rawProgress === 'number' && Number.isFinite(rawProgress)
      ? Math.min(100, Math.max(0, rawProgress))
      : undefined;
  const indicator: 'busy' | 'error' | 'file' =
    status === 'error' || status === 'cancelled' ? 'error' : busy ? 'busy' : 'file';

  return {
    busy,
    canPreview: status === 'success',
    /** A failure that would only repeat (e.g. over the size limit) offers removal, not retry. */
    canRetry: (status === 'error' || status === 'cancelled') && retryable !== false,
    /** Every busy step shares one `busy` indicator, so users see a single spinner throughout. */
    indicator,
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
