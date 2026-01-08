import { LobeChatDatabase } from '@lobechat/database';
import urlJoin from 'url-join';

import { FileModel } from '@/database/models/file';
import { fileEnv } from '@/envs/file';
import { FileS3 } from '@/server/modules/S3';

import { type FileServiceImpl } from './type';
import { extractKeyFromUrlOrReturnOriginal } from './utils';

/**
 * S3-based file service implementation
 */
export class S3StaticFileImpl implements FileServiceImpl {
  private readonly s3: FileS3;
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
    this.s3 = new FileS3();
  }

  async deleteFile(key: string) {
    return this.s3.deleteFile(key);
  }

  async deleteFiles(keys: string[]) {
    return this.s3.deleteFiles(keys);
  }

  async getFileContent(key: string): Promise<string> {
    return this.s3.getFileContent(key);
  }

  async getFileByteArray(key: string): Promise<Uint8Array> {
    return this.s3.getFileByteArray(key);
  }

  async createPreSignedUrl(key: string): Promise<string> {
    return this.s3.createPreSignedUrl(key);
  }

  async getFileMetadata(key: string): Promise<{ contentLength: number; contentType?: string }> {
    return this.s3.getFileMetadata(key);
  }

  async createPreSignedUrlForPreview(key: string, expiresIn?: number): Promise<string> {
    return this.s3.createPreSignedUrlForPreview(key, expiresIn);
  }

  async uploadContent(path: string, content: string) {
    return this.s3.uploadContent(path, content);
  }

  async getFullFileUrl(url?: string | null, expiresIn?: number): Promise<string> {
    if (!url) return '';

    // Handle legacy data compatibility using shared utility
    const key = await extractKeyFromUrlOrReturnOriginal(url, this.getKeyFromFullUrl.bind(this));

    // If bucket is not set public read, the preview address needs to be regenerated each time
    if (!fileEnv.S3_SET_ACL) {
      return await this.createPreSignedUrlForPreview(key, expiresIn);
    }

    if (fileEnv.S3_ENABLE_PATH_STYLE) {
      return urlJoin(fileEnv.S3_PUBLIC_DOMAIN!, fileEnv.S3_BUCKET!, key);
    }

    return urlJoin(fileEnv.S3_PUBLIC_DOMAIN!, key);
  }

  async getKeyFromFullUrl(url: string): Promise<string | null> {
    const urlParts = url.split('/');
    const fIndex = urlParts.indexOf('f');
    const fileId = urlParts[fIndex + 1];

    const file = await FileModel.getFileById(this.db, fileId);
    return file?.url ?? null;
  }

  async uploadMedia(key: string, buffer: Buffer): Promise<{ key: string }> {
    await this.s3.uploadMedia(key, buffer);
    return { key };
  }
}
