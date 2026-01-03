import { S3StaticFileImpl } from './s3';
import { type FileServiceImpl } from './type';

/**
 * Create file service module
 * Returns S3 file implementation for cloud storage
 */
export const createFileServiceModule = (): FileServiceImpl => {
  return new S3StaticFileImpl();
};

export type { FileServiceImpl } from './type';
