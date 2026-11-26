import type { FileDocument } from '@lobechat/file-loaders';

import { LOAD_FAILED_ERROR_NAME } from './protocol';

export class FileLoadFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = LOAD_FAILED_ERROR_NAME;
  }
}

/**
 * `loadFile` reports a whole-file failure as error pages plus `metadata.error` instead of throwing.
 * Storing that as a document would cache an empty "successful" parse, so the failure is refused
 * here. A load with usable content and a secondary error (e.g. metadata attach) is still accepted.
 */
export const assertFileLoaded = (loaded: FileDocument): FileDocument => {
  const error = loaded.metadata?.error;
  if (!error) return loaded;

  const allPagesFailed =
    !!loaded.pages?.length && loaded.pages.every((page) => page.metadata?.error);
  if (allPagesFailed || loaded.content.trim() === '') throw new FileLoadFailedError(error);

  return loaded;
};
