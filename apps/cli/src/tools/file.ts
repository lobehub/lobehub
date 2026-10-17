import {
  getLocalImageMimeType,
  type ReadFileParams,
  readLocalFile as readLocalTextFile,
  readLocalImageFile,
  type UploadedImageRecord,
} from '@lobechat/local-file-shell';

export {
  editLocalFile,
  globLocalFiles,
  grepContent,
  listLocalFiles,
  searchLocalFiles,
  writeLocalFile,
} from '@lobechat/local-file-shell';

/** Uploads a local image to file storage with the connected device's credentials. */
export type ImageUploader = (filePath: string) => Promise<UploadedImageRecord | undefined>;

/**
 * `readFile` for a connected device. Images are uploaded to file storage, as
 * the desktop app does, so vision models can see them instead of hitting
 * "Unsupported binary file type"; every other path reads as text. Without an
 * uploader the image degrades to a placeholder the model can explain.
 */
export const readLocalFile = async (params: ReadFileParams, uploadImage?: ImageUploader) => {
  const imageMimeType = getLocalImageMimeType(params.path);
  if (!imageMimeType) return readLocalTextFile(params);

  return readLocalImageFile(params, imageMimeType, {
    upload: async (filePath) => uploadImage?.(filePath),
  });
};
