import { type LobeChatDatabase, type Transaction } from '@lobechat/database';
import { ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import type { FileAccessScope, FileSource } from '@lobechat/types';
import { ordinaryFileAccessScope } from '@lobechat/types';
import { inferContentTypeFromImageUrl, nanoid, uuid } from '@lobechat/utils';
import { TRPCError } from '@trpc/server';
import { sha256 } from 'js-sha256';
import pMap from 'p-map';

import { serverDBEnv } from '@/config/db';
import { FileModel } from '@/database/models/file';
import { type FileItem } from '@/database/schemas';
import { buildTenantPublicUrl } from '@/server/modules/Tenant/callbackUrl';
import { classifyEnterpriseContentIds } from '@/server/services/enterpriseKnowledge/contentClassification';
import { TempFileManager } from '@/server/utils/tempFileManager';
import type { EnterpriseItemAccess } from '@/types/files';
import { isDev } from '@/utils/env';

import { createFileServiceModule } from './impls';
import type { FileServiceImpl, PreSignedUpload } from './impls/type';

/** The file proxy of the current tenant: `/f/{id}` is a tenant backend route. */
export const getFileProxyUrl = (fileId: string): string => buildTenantPublicUrl(`/f/${fileId}`);

export interface FileAccessUrlItem {
  enterpriseAccess?: EnterpriseItemAccess;
  fileId?: string | null;
  id?: string | null;
  url?: string | null;
}

interface FileRecordParams {
  fileHash: string;
  fileType: string;
  id?: string;
  metadata?: Record<string, unknown>;
  name: string;
  size: number;
  source?: FileItem['source'];
  url: string;
  visibility?: FileItem['visibility'];
}

/**
 * File service class
 * Provides file operation services using a modular implementation approach
 */
export class FileService {
  private db: LobeChatDatabase;

  private userId: string;
  private fileModel: FileModel;

  private impl: FileServiceImpl;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.workspaceId = workspaceId;
    this.userId = userId;
    this.fileModel = new FileModel(db, userId, workspaceId);
    this.impl = createFileServiceModule(db);
  }

  /**
   * Delete file
   */
  public async deleteFile(key: string) {
    return this.impl.deleteFile(key);
  }

  /**
   * Reclaims an unreferenced upload and its exclusively owned stored object.
   *
   * Use when:
   * - An import fails or its final owning document is permanently deleted.
   *
   * Expects:
   * - The file is in the caller's scope and matches the requested upload source.
   *
   * Returns:
   * - Void; referenced files and shared objects remain intact.
   *
   * Call stack:
   * AgentDocumentsService.importFile / AgentDocumentVfsService.deletePermanently
   *   -> {@link FileService.removeUnreferencedFile}
   *     -> {@link FileModel.deleteUnreferenced}
   *     -> {@link FileService.deleteFile}
   */
  public async removeUnreferencedFile(id: string, source: FileSource): Promise<void> {
    const file = await this.fileModel.deleteUnreferenced(id, {
      removeGlobalFile: serverDBEnv.REMOVE_GLOBAL_FILE,
      source,
    });
    // The model returns an object key only after its final file reference is removed.
    if (file) await this.deleteFile(file.url);
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
  public async getFileContent(key: string, byteLength?: number): Promise<string> {
    return byteLength === undefined
      ? this.impl.getFileContent(key)
      : this.impl.getFileContent(key, byteLength);
  }

  public async getFileStream(
    key: string,
    range?: string,
    signal?: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    return this.impl.getFileStream(key, range, signal);
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
   * Create pre-signed upload descriptor
   */
  public async createPreSignedUpload(
    key: string,
    options?: { private?: boolean },
  ): Promise<PreSignedUpload> {
    return this.impl.createPreSignedUpload(key, options);
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
   * Create a storage URL whose response is delivered as a browser download.
   */
  public async createDownloadUrl(
    url: string,
    fileName: string,
    expiresIn?: number,
  ): Promise<string> {
    return this.impl.createDownloadUrl(url, fileName, expiresIn);
  }

  /**
   * Create cached pre-signed preview URL
   */
  public async createCachedPreSignedUrlForPreview(
    url?: string | null,
    expiresIn?: number,
  ): Promise<string> {
    return this.impl.createCachedPreSignedUrlForPreview(url, expiresIn);
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
    // Native documents keep their content in the database, not object storage.
    if (url?.startsWith('internal://')) return '';

    return this.impl.getFullFileUrl(url, expiresIn);
  }

  /**
   * Resolve a file URL for consumers that need to read the file.
   * Production uses the stable file proxy URL; local development falls back to
   * the storage URL so remote model providers can download local test files.
   */
  public async getFileAccessUrl(file: FileAccessUrlItem): Promise<string> {
    const fileId = file.fileId || file.id;

    if (!isDev && fileId) {
      return getFileProxyUrl(fileId);
    }

    return this.getFullFileUrl(file.url);
  }

  /** Classify a whole browser response once. Authorization belongs to the proxy. */
  public async getFileBrowserUrls(
    items: FileAccessUrlItem[],
    options?: { readable?: boolean },
  ): Promise<string[]> {
    const ids = [
      ...new Set(
        items
          .filter(
            (file) =>
              !file.enterpriseAccess && !(options?.readable && file.url?.startsWith('internal://')),
          )
          .map((file) => file.fileId || file.id)
          .filter((id): id is string => !!id),
      ),
    ];
    const enterpriseIds = ids.length
      ? await classifyEnterpriseContentIds(
          { serverDB: this.db, workspaceId: this.workspaceId },
          ids,
        )
      : new Set<string>();
    return pMap(
      items,
      (file) => {
        if (options?.readable && file.url?.startsWith('internal://')) return '';
        const id = file.fileId || file.id;
        if (id && (file.enterpriseAccess || enterpriseIds.has(id))) return getFileProxyUrl(id);
        return options?.readable ? this.getFullFileUrl(file.url) : this.getFileAccessUrl(file);
      },
      { concurrency: 10 },
    );
  }

  public async getFileBrowserUrl(
    file: FileAccessUrlItem,
    options?: { readable?: boolean },
  ): Promise<string> {
    return (await this.getFileBrowserUrls([file], options))[0];
  }

  /**
   * Extract key from full URL
   */
  public async getKeyFromFullUrl(url: string): Promise<string | null> {
    return this.impl.getKeyFromFullUrl(url);
  }

  /**
   * Upload media file (images only)
   */
  public async uploadMedia(key: string, buffer: Buffer): Promise<{ key: string }> {
    return this.impl.uploadMedia(key, buffer);
  }

  /**
   * Upload buffer with specified content type (for any file type)
   */
  public async uploadBuffer(
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<{ key: string }> {
    return this.impl.uploadBuffer(key, buffer, contentType);
  }

  private async isStoredFileAvailable(url: string): Promise<boolean> {
    try {
      await this.getFileMetadata(url);
      return true;
    } catch (error) {
      console.error('Failed to verify existing file hash storage object:', error);
      return false;
    }
  }

  /**
   * Create file record (common method)
   * Automatically handles globalFiles deduplication logic
   *
   * @param params - File parameters
   * @param params.id - Optional custom file ID (defaults to auto-generated)
   * @returns File record and proxy URL
   */
  public async createFileRecord(
    params: FileRecordParams,
  ): Promise<{ fileId: string; url: string }> {
    const id = await this.writeFileRecord(params);

    return { fileId: id, url: await this.getFileAccessUrl({ id, url: params.url }) };
  }

  /**
   * Writes the file row, and the globalFiles row its hash needs, in one transaction.
   *
   * The storage probe of an existing hash runs before that transaction: a HeadObject round trip
   * must not keep a pooled connection checked out, and every query inside goes through `trx`, so
   * the write never borrows a second connection from the pool it already holds one of.
   *
   * @param beforeRecord - Runs first inside the transaction (e.g. an admission check holding the
   *   owner lock); a rejection rolls the write back.
   */
  private async writeFileRecord(
    params: FileRecordParams,
    beforeRecord?: (trx: Transaction) => Promise<void>,
  ): Promise<string> {
    const observed = await this.fileModel.checkHash(params.fileHash);
    // An existing hash row whose object is gone follows this upload, so hash dedup keeps
    // resolving to a live object after the previous one was removed.
    const missingHashUrl =
      observed.isExist &&
      observed.url &&
      observed.url !== params.url &&
      !(await this.isStoredFileAvailable(observed.url))
        ? observed.url
        : undefined;

    const { id } = await this.db.transaction(async (trx) => {
      await beforeRecord?.(trx);

      // The probe only describes the mapping it saw. When the row has moved since (another upload
      // replaced or removed it), decide from the current row and leave a replaced pointer as is:
      // it was not probed, and the next upload of these bytes probes it again.
      const current = await this.fileModel.checkHash(params.fileHash, trx);
      if (missingHashUrl && current.isExist && current.url === missingHashUrl) {
        await this.fileModel.updateGlobalFile(
          params.fileHash,
          { metadata: params.metadata, url: params.url },
          trx,
        );
      }

      return this.fileModel.create(
        {
          fileHash: params.fileHash,
          fileType: params.fileType,
          id: params.id, // Use custom ID if provided
          metadata: params.metadata,
          name: params.name,
          size: params.size,
          source: params.source,
          url: params.url,
          visibility: params.visibility,
        },
        !current.isExist, // insertToGlobalFiles
        trx,
      );
    });

    return id;
  }

  /**
   * Delete user file record but keep globalFiles record
   * Used for GitHub skill imports where we only need globalFiles for foreign key
   *
   * @param fileId - File ID to delete from user's files table
   */
  public async deleteUserFileRecord(fileId: string): Promise<void> {
    await this.fileModel.delete(fileId, { removeGlobalFile: false });
  }

  /**
   * Create global file record only (no user file record)
   * Used for skill resources that should not appear in user's file list
   *
   * @param params - File parameters
   * @returns fileHash for reference
   */
  public async createGlobalFile(params: {
    fileHash: string;
    fileType: string;
    metadata?: { dirname: string; filename: string; path: string };
    size: number;
    url: string;
  }): Promise<{ fileHash: string }> {
    // Check if hash already exists
    const existing = await this.fileModel.checkHash(params.fileHash);

    if (!existing.isExist) {
      // Create new record
      await this.fileModel.createGlobalFile({
        creator: this.userId,
        fileType: params.fileType,
        hashId: params.fileHash,
        metadata: params.metadata,
        size: params.size,
        url: params.url,
      });
    } else if (existing.url !== params.url) {
      // Hash exists but URL changed (file re-uploaded to different S3 path) — update URL
      await this.fileModel.updateGlobalFile(params.fileHash, {
        metadata: params.metadata,
        url: params.url,
      });
    }

    return { fileHash: params.fileHash };
  }

  /**
   * Get file content by hash from globalFiles
   * Used for reading skill resources stored in globalFiles only
   *
   * @param fileHash - File hash (globalFiles.hashId)
   * @returns File content as string
   */
  public async getFileContentByHash(fileHash: string): Promise<string> {
    const result = await this.fileModel.checkHash(fileHash);
    if (!result.isExist || !result.url) {
      throw new TRPCError({ code: 'NOT_FOUND', message: `Global file not found: ${fileHash}` });
    }
    return this.getFileContent(result.url);
  }

  public async getFileByteArrayByHash(fileHash: string): Promise<Uint8Array> {
    const result = await this.fileModel.checkHash(fileHash);
    if (!result.isExist || !result.url) {
      throw new TRPCError({ code: 'NOT_FOUND', message: `Global file not found: ${fileHash}` });
    }
    return this.getFileByteArray(result.url);
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
    options?: { fileType?: string },
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
    const dirname = pathname.split('/').slice(0, -1).join('/');

    // Calculate file metadata
    const size = buffer.length;
    let fileType = options?.fileType || 'application/octet-stream';
    if (!options?.fileType) {
      try {
        fileType = inferContentTypeFromImageUrl(pathname);
      } catch {
        // Non-image files (e.g. audio) won't match image extension whitelist
      }
    }
    const hash = sha256(buffer);

    // Generate UUID for cleaner URLs
    const fileId = uuid();

    // Use common method to create file record
    const { fileId: createdId, url } = await this.createFileRecord({
      fileHash: hash,
      fileType,
      id: fileId, // Use UUID instead of auto-generated ID
      // Keep generated/base64 uploads compatible with UI hash-dedup, which reads metadata.path.
      metadata: {
        date: new Date().toISOString().slice(0, 10),
        dirname,
        filename: name,
        path: key,
      },
      name,
      size,
      url: key, // Store original key (S3 key or desktop://)
    });

    return { fileId: createdId, key, url };
  }

  /**
   * Upload a buffer to S3 and create database record.
   * Used by the bot platform to upload media directly without data URL roundtrip.
   */
  public async uploadFromBuffer(
    buffer: Buffer,
    mimeType: string,
    pathname: string,
    /**
     * Runs inside the transaction that writes the file row, so an admission check
     * can hold its owner lock without spanning the upload itself. The stored object
     * is removed again when it rejects.
     */
    beforeRecord?: (trx: Transaction) => Promise<void>,
    recordOptions?: Pick<FileItem, 'source' | 'visibility'>,
  ): Promise<{ fileId: string; key: string; url: string }> {
    // Use uploadBuffer with explicit contentType so S3 Content-Type matches
    // the actual bytes (e.g. PNG buffer won't get image/jpeg from .jpg pathname)
    const { key } = await this.uploadBuffer(pathname, buffer, mimeType);

    const name = pathname.split('/').pop() || 'unknown';
    const size = buffer.length;
    const hash = sha256(buffer);
    const fileId = uuid();

    // Derive dirname from pathname for metadata compatibility with UI upload path.
    // UI stores { date, dirname, filename, path } in globalFiles.metadata;
    // checkFileHash returns this metadata for dedup — bot records must match.
    const parts = pathname.split('/');
    const filename = parts.pop() || name;
    const dirname = parts.join('/');

    const createdId = await this.writeFileRecord(
      {
        fileHash: hash,
        fileType: mimeType,
        id: fileId,
        metadata: {
          date: new Date().toISOString().slice(0, 10),
          dirname,
          filename,
          path: pathname,
        },
        name,
        size,
        url: key,
        ...recordOptions,
      },
      beforeRecord,
    ).catch(async (error) => {
      // A failed write leaves no row pointing at the object, so the object is ours to remove.
      await this.deleteFile(key).catch(() => {});
      throw error;
    });
    const url = await this.getFileAccessUrl({ id: createdId, url: key });

    return { fileId: createdId, key, url };
  }

  /**
   * Download file from external URL, upload to S3, and create database record
   * @param externalUrl - External file URL to download (e.g., Discord CDN)
   * @param pathname - File storage path in S3 (must include file extension)
   * @returns Contains key (storage path), fileId (database record ID) and url (proxy access path)
   */
  public async uploadFromUrl(
    externalUrl: string,
    pathname: string,
  ): Promise<{ fileId: string; key: string; url: string }> {
    // `externalUrl` is caller-provided: keep it off private and metadata addresses.
    const response = await ssrfSafeFetch(externalUrl);

    if (!response.ok) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Failed to download file from URL: ${response.status} ${response.statusText}`,
      });
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // Upload to storage (S3 or local)
    const { key } = await this.uploadMedia(pathname, buffer);

    // Extract filename from pathname
    const name = pathname.split('/').pop() || 'unknown';

    // Calculate file metadata
    const size = buffer.length;
    let fileType = response.headers.get('content-type') || '';
    if (!fileType || fileType === 'application/octet-stream') {
      try {
        fileType = inferContentTypeFromImageUrl(pathname);
      } catch {
        // inferContentTypeFromImageUrl throws for non-image extensions — fall back
        fileType = fileType || 'application/octet-stream';
      }
    }
    const hash = sha256(buffer);

    // Generate UUID for cleaner URLs
    const fileId = uuid();

    // Use common method to create file record
    const { fileId: createdId, url } = await this.createFileRecord({
      fileHash: hash,
      fileType,
      id: fileId,
      name,
      size,
      url: key,
    });

    return { fileId: createdId, key, url };
  }

  /**
   * Downloads a stored file to a temp path. `maxBytes` (optional) refuses a file larger than the
   * limit before any bytes are read, by the stored size, and again by the bytes actually received.
   * Callers that do not pass it (skill ZIP import) keep their own limits.
   */
  async downloadFileToLocal(
    fileId: string,
    accessScope: FileAccessScope = ordinaryFileAccessScope,
    options: { maxBytes?: number } = {},
  ): Promise<{ cleanup: () => Promise<void>; file: FileItem; filePath: string }> {
    const file = await this.fileModel.findById(fileId, { accessScope });
    if (!file) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'File not found' });
    }

    const { maxBytes } = options;
    const tooLarge = () =>
      new TRPCError({
        code: 'PAYLOAD_TOO_LARGE',
        message: `Files larger than ${maxBytes} bytes cannot be parsed in memory`,
      });
    if (maxBytes !== undefined && file.size > maxBytes) throw tooLarge();

    let content: Uint8Array | undefined;
    try {
      content = await this.getFileByteArray(file.url);
    } catch (e) {
      console.error(e);
      // if file not found, delete it from db
      if ((e as any).Code === 'NoSuchKey') {
        await this.fileModel.delete(fileId, {
          accessScope,
          removeGlobalFile: serverDBEnv.REMOVE_GLOBAL_FILE,
        });
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'File not found' });
      }
    }

    if (!content) throw new TRPCError({ code: 'BAD_REQUEST', message: 'File content is empty' });
    if (maxBytes !== undefined && content.byteLength > maxBytes) throw tooLarge();

    const dir = nanoid();
    const tempManager = new TempFileManager(dir);

    const filePath = await tempManager.writeTempFile(content, file.name);
    return { cleanup: () => tempManager.cleanup(), file, filePath };
  }
}
