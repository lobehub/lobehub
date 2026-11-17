import { toast } from '@lobehub/ui';
import { t } from 'i18next';

import type { UploadFileItem } from '@/types/files/upload';

const isFailedUpload = (item: Pick<UploadFileItem, 'status'>): boolean =>
  item.status === 'error' || item.status === 'cancelled';

/**
 * Stops a send while the draft still holds an upload that failed or was cancelled.
 *
 * Such an attachment never became a stored file: its id is a placeholder (the file
 * name), so the server finds nothing behind it, and the agent gets the message
 * without the file. When the draft has no text, the agent gets an empty message.
 * The draft is kept, and the toast names the files to retry or remove.
 *
 * @returns `true` when the send must not go out
 */
export const refuseSendWithFailedUploads = (
  files: Pick<UploadFileItem, 'file' | 'status'>[],
): boolean => {
  const failed = files.filter(isFailedUpload);
  if (failed.length === 0) return false;

  toast.error(
    t('upload.validation.failedNotSent', {
      files: failed.map((item) => item.file.name).join(', '),
      ns: 'chat',
    }),
  );
  return true;
};
