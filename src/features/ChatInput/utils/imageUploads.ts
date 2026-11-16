import type { UploadFileItem } from '@/types/files/upload';

export const isImageUpload = (item: Pick<UploadFileItem, 'file'>): boolean =>
  item.file.type.startsWith('image');

/** A failed or cancelled upload is not sent with the message, so it takes no number. */
const isSendableImageUpload = (item: Pick<UploadFileItem, 'file' | 'status'>): boolean =>
  isImageUpload(item) && item.status !== 'error' && item.status !== 'cancelled';

/**
 * 1-based position of each upload among the draft's image uploads, aligned with `files`
 * (`undefined` for non-image uploads and for images that failed to upload).
 *
 * The number shown on the thumbnail badge and on inline `[Image #N]` references is the
 * image's position in the message's image list, so the model can match a reference with
 * the N-th image it receives. Removing an image renumbers the rest, and the badges and
 * references follow together. Positions are used instead of ids because an upload's id is
 * its file name until the upload finishes, and pasted images often share one.
 */
export const getImageUploadNumbers = (files: UploadFileItem[]): (number | undefined)[] => {
  let count = 0;
  return files.map((item) => (isSendableImageUpload(item) ? ++count : undefined));
};

export interface ImageUploadRef {
  /**
   * The uploaded file's id, only once the upload finished: until then an upload's id is its
   * file name, which pasted images often share.
   */
  fileId?: string;
  number: number;
  src: string;
}

/**
 * Image uploads addressable by an inline reference, keyed by their local preview URL.
 *
 * The object URL created for the preview is unique per upload and stays the same while
 * the upload's id changes from the file name to the server id.
 */
export const getImageUploadRefs = (files: UploadFileItem[]): Map<string, ImageUploadRef> => {
  const numbers = getImageUploadNumbers(files);
  const refs = new Map<string, ImageUploadRef>();
  files.forEach((item, index) => {
    const number = numbers[index];
    if (!number || !item.previewUrl) return;
    refs.set(item.previewUrl, {
      ...(item.status === 'success' && { fileId: item.id }),
      number,
      src: item.previewUrl,
    });
  });
  return refs;
};
