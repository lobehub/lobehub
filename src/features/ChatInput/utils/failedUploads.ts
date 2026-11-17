import type { UploadFileItem } from '@/types/files/upload';

/**
 * An upload that ended without a file record. Its id is still the local upload id, so
 * sending it would attach nothing and the agent would receive the message without it.
 */
export const isFailedUpload = (item: Pick<UploadFileItem, 'status'>): boolean =>
  item.status === 'error' || item.status === 'cancelled';

/** Names of the uploads that must be retried or removed before the draft can be sent. */
export const getFailedUploadNames = (files: Pick<UploadFileItem, 'file' | 'status'>[]): string[] =>
  files.filter(isFailedUpload).map((item) => item.file.name);
