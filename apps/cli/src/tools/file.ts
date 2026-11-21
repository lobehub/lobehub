import type {
  GrepContentParams,
  ReadFileParams,
  UploadedImageRecord,
} from '@lobechat/local-file-shell';
import {
  getLocalImageMimeType,
  readLocalFile as readLocalTextFile,
  readLocalImageFile,
} from '@lobechat/local-file-shell';
import { createContentSearchImpl } from '@lobechat/local-file-shell/content-search';

export {
  editLocalFile,
  globLocalFiles,
  listLocalFiles,
  searchLocalFiles,
  writeLocalFile,
} from '@lobechat/local-file-shell';

const contentSearch = createContentSearchImpl();

export const grepContent = (params: GrepContentParams) =>
  contentSearch.grep({ ...params, glob: params.glob ?? params.filePattern });

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
