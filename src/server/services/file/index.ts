import type {LobeChatDatabase} from '@lobechat/database';
import { inferContentTypeFromImageUrl, nanoid, uuid } from '@lobechat/utils';
import { TRPCError } from '@trpc/server';
import { sha256 } from 'js-sha256';

import { serverDBEnv } from '@/config/db';
import { FileModel } from '@/database/models/file';
import type {FileItem} from '@/database/schemas';
import { appEnv } from '@/envs/app';
import { TempFileManager } from '@/server/utils/tempFileManager';

import { createFileServiceModule } from './impls';
import type {FileServiceImpl} from './impls/type';

/**
 * File service class
 * Provides file operation services using a modular implementation approach
 */
export class FileService {
  private userId: string;
  private fileModel: FileModel;

  private impl: FileServiceImpl;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.fileModel = new FileModel(db, userId);
    this.impl = createFileServiceModule(db);
  }

  /**
   * Delete file
   */
  public async deleteFile(key: string) {
    return this.impl.deleteFile(key);
  }

  /**
   * Delete files in batch
   */
  public async deleteFiles(keys: string[]) {
    return this.impl.deleteFiles(keys);
  }

  /**
   * Get file content
   */
  public async getFileContent(key: string): Promise<string> {
    return this.impl.getFileContent(key);
  }

  /**
   * Get file byte array
   */
  public async getFileByteArray(key: string): Promise<Uint8Array> {
    return this.impl.getFileByteArray(key);
  }

  /**
   * Create pre-signed upload URL
   */
  public async createPreSignedUrl(key: string): Promise<string> {
    return this.impl.createPreSignedUrl(key);
  }

  /**
   * Get file metadata from storage
   * Used to verify actual file size instead of trusting client-provided values
   */
  public async getFileMetadata(
    key: string,
  ): Promise<{ contentLength: number; contentType?: string }> {
    return this.impl.getFileMetadata(key);
  }

  /**
   * Create pre-signed preview URL
   */
  public async createPreSignedUrlForPreview(key: string, expiresIn?: number): Promise<string> {
    return this.impl.createPreSignedUrlForPreview(key, expiresIn);
  }

  /**
   * Upload content
   */
  public async uploadContent(path: string, content: string) {
    return this.impl.uploadContent(path, content);
  }

  /**
   * Get full file URL
   */
  public async getFullFileUrl(url?: string | null, expiresIn?: number): Promise<string> {
    return this.impl.getFullFileUrl(url, expiresIn);
  }

  /**
   * Extract key from full URL
   */
  public async getKeyFromFullUrl(url: string): Promise<string | null> {
    return this.impl.getKeyFromFullUrl(url);
  }

  /**
   * Upload media file
   */
  public async uploadMedia(key: string, buffer: Buffer): Promise<{ key: string }> {
    return this.impl.uploadMedia(key, buffer);
  }

  /**
   * Create file record (common method)
   * Automatically handles globalFiles deduplication logic
   *
   * @param params - File parameters
   * @param params.id - Optional custom file ID (defaults to auto-generated)
   * @returns File record and proxy URL
   */
  public async createFileRecord(params: {
    fileHash: string;
    fileType: string;
    id?: string;
    name: string;
    size: number;
    url: string;
  }): Promise<{ fileId: string; url: string }> {
    // Check if hash already exists in globalFiles
    const { isExist } = await this.fileModel.checkHash(params.fileHash);

    // Create database record
    // If hash doesn't exist, also create globalFiles record
    const { id } = await this.fileModel.create(
      {
        fileHash: params.fileHash,
        fileType: params.fileType,
        id: params.id, // Use custom ID if provided
        name: params.name,
        size: params.size,
        url: params.url,
      },
      !isExist, // insertToGlobalFiles
    );

    // Return unified proxy URL: ${APP_URL}/f/:id
    return {
      fileId: id,
      url: `${appEnv.APP_URL}/f/${id}`,
    };
  }

  /**
   * Upload base64 data and create database record
   * @param base64Data - Base64 data (supports data URI format or pure base64)
   * @param pathname - File storage path (must include file extension)
   * @returns Contains key (storage path), fileId (database record ID) and url (proxy access path)
   */
  public async uploadBase64(
    base64Data: string,
    pathname: string,
  ): Promise<{ fileId: string; key: string; url: string }> {
    let base64String: string;

    // If data URI format (data:image/png;base64,xxx)
    if (base64Data.startsWith('data:')) {
      const commaIndex = base64Data.indexOf(',');
      if (commaIndex === -1) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid base64 data format' });
      }
      base64String = base64Data.slice(commaIndex + 1);
    } else {
      // Pure base64 string
      base64String = base64Data;
    }

    // Convert to Buffer
    const buffer = Buffer.from(base64String, 'base64');

    // Upload to storage (S3 or local)
    const { key } = await this.uploadMedia(pathname, buffer);

    // Extract filename from pathname
    const name = pathname.split('/').pop() || 'unknown';

    // Calculate file metadata
    const size = buffer.length;
    const fileType = inferContentTypeFromImageUrl(pathname) || 'application/octet-stream';
    const hash = sha256(buffer);

    // Generate UUID for cleaner URLs
    const fileId = uuid();

    // Use common method to create file record
    const { fileId: createdId, url } = await this.createFileRecord({
      fileHash: hash,
      fileType,
      id: fileId, // Use UUID instead of auto-generated ID
      name,
      size,
      url: key, // Store original key (S3 key or desktop://)
    });

    return { fileId: createdId, key, url };
  }

  async downloadFileToLocal(
    fileId: string,
  ): Promise<{ cleanup: () => void; file: FileItem; filePath: string }> {
    const file = await this.fileModel.findById(fileId);
    if (!file) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'File not found' });
    }

    let content: Uint8Array | undefined;
    try {
      content = await this.getFileByteArray(file.url);
    } catch (e) {
      console.error(e);
      // if file not found, delete it from db
      if ((e as any).Code === 'NoSuchKey') {
        await this.fileModel.delete(fileId, serverDBEnv.REMOVE_GLOBAL_FILE);
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'File not found' });
      }
    }

    if (!content) throw new TRPCError({ code: 'BAD_REQUEST', message: 'File content is empty' });

    const dir = nanoid();
    const tempManager = new TempFileManager(dir);

    const filePath = await tempManager.writeTempFile(content, file.name);
    return { cleanup: () => tempManager.cleanup(), file, filePath };
  }
}
