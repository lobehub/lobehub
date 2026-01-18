import { DeleteFilesResponse } from '@lobechat/electron-server-ipc';
import * as fs from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path, { join } from 'node:path';
import { promisify } from 'node:util';

import { FILE_STORAGE_DIR, LOCAL_STORAGE_URL_PREFIX } from '@/const/dir';
import { makeSureDirExist } from '@/utils/file-system';
import { createLogger } from '@/utils/logger';

import { ServiceModule } from './index';

/**
 * File not found error class
 */
export class FileNotFoundError extends Error {
  constructor(
    message: string,
    public path: string,
  ) {
    super(message);
    this.name = 'FileNotFoundError';
  }
}

const readFilePromise = promisify(fs.readFile);
const unlinkPromise = promisify(fs.unlink);

// Create logger
const logger = createLogger('services:FileService');

interface UploadFileParams {
  content: ArrayBuffer | string; // ArrayBuffer from browser or Base64 string from server
  filename: string;
  hash: string;
  path: string;
  type: string;
}

export interface FileMetadata {
  date: string;
  dirname: string;
  filename: string;
  path: string;
}

export default class FileService extends ServiceModule {
  /**
   * Get legacy upload directory path
   * @deprecated Only for backward compatibility with legacy file access, new files should be stored under custom paths in FILE_STORAGE_DIR
   */
  get UPLOADS_DIR() {
    return join(this.app.appStoragePath, FILE_STORAGE_DIR, 'uploads');
  }

  constructor(app) {
    super(app);
  }

  /**
   * Upload file to local storage
   */
  async uploadFile({
    content,
    filename,
    hash,
    path: filePath,
    type,
  }: UploadFileParams): Promise<{ metadata: FileMetadata; success: boolean }> {
    logger.info(`Starting to upload file: ${filename}, hash: ${hash}, path: ${filePath}`);
    try {
      // Get current timestamp, avoid repeated Date.now() calls
      const now = Date.now();
      const date = (now / 1000 / 60 / 60).toFixed(0);

      // Use provided filePath as the file storage path
      const fullStoragePath = join(this.app.appStoragePath, FILE_STORAGE_DIR, filePath);
      logger.debug(`Target file storage path: ${fullStoragePath}`);

      // Ensure target directory exists
      const targetDir = path.dirname(fullStoragePath);
      logger.debug(`Ensuring target directory exists: ${targetDir}`);
      makeSureDirExist(targetDir);

      const savedPath = fullStoragePath;
      logger.debug(`Final file save path: ${savedPath}`);

      // Create Buffer based on content type
      let buffer: Buffer;
      if (typeof content === 'string') {
        // Base64 string from server
        buffer = Buffer.from(content, 'base64');
        logger.debug(`Creating buffer from Base64 string, size: ${buffer.length} bytes`);
      } else {
        // ArrayBuffer from browser
        buffer = Buffer.from(content);
        logger.debug(`Creating buffer from ArrayBuffer, size: ${buffer.length} bytes`);
      }
      await writeFile(savedPath, buffer);

      // Write metadata file
      const metaFilePath = `${savedPath}.meta`;
      const metadata = {
        createdAt: now, // Use unified timestamp
        filename,
        hash,
        size: buffer.length,
        type,
      };
      logger.debug(`Writing metadata file: ${metaFilePath}`);
      await writeFile(metaFilePath, JSON.stringify(metadata, null, 2));

      // Return S3-compatible metadata format
      const desktopPath = `desktop://${filePath}`;
      logger.info(`File upload successful: ${desktopPath}`);

      // Extract filename and directory information from path
      const parsedPath = path.parse(filePath);
      const dirname = parsedPath.dir || '';
      const savedFilename = parsedPath.base;

      return {
        metadata: {
          date, // Keep timestamp format for compatibility and time tracking
          dirname,
          filename: savedFilename,
          path: desktopPath,
        },
        success: true,
      };
    } catch (error) {
      logger.error(`File upload failed:`, error);
      throw new Error(`File upload failed: ${(error as Error).message}`);
    }
  }

  /**
   * Check if path is in legacy format (timestamp directory)
   *
   * Legacy path format: {timestamp}/{hash}.{ext} (e.g., 1234567890/abc123.png)
   * New path format: arbitrary custom paths (e.g., user_uploads/images/photo.png, ai_generations/image.jpg)
   *
   * @param path - Relative path, without desktop:// prefix
   * @returns true if legacy format, false if new format
   */
  private isLegacyPath(path: string): boolean {
    const parts = path.split('/');
    if (parts.length < 2) return false;

    // If the first part is purely numeric (timestamp), consider it legacy format
    // Timestamp format: Unix timestamp accurate to the hour, typically 10 digits
    return /^\d+$/.test(parts[0]);
  }

  /**
   * Get file content
   */
  async getFile(path: string): Promise<{ content: ArrayBuffer; mimeType: string }> {
    logger.info(`Getting file content: ${path}`);
    try {
      // 处理desktop://路径
      if (!path.startsWith('desktop://')) {
        logger.error(`Invalid desktop file path: ${path}`);
        throw new Error(`Invalid desktop file path: ${path}`);
      }

      // Normalize path format
      // Possible formats received: desktop:/12345/file.png or desktop://12345/file.png
      const normalizedPath = path.replace(/^desktop:\/+/, 'desktop://');
      logger.debug(`Normalized path: ${normalizedPath}`);

      // Parse path
      const relativePath = normalizedPath.replace('desktop://', '');

      // Smart routing: decide which directory to read file from based on path format
      let filePath: string;
      let isLegacyAttempt = false;

      if (this.isLegacyPath(relativePath)) {
        // Legacy path: read from uploads directory (backward compatibility)
        filePath = join(this.UPLOADS_DIR, relativePath);
        isLegacyAttempt = true;
        logger.debug(`Legacy path detected, reading from uploads directory: ${filePath}`);
      } else {
        // New path: read from FILE_STORAGE_DIR root directory
        filePath = join(this.app.appStoragePath, FILE_STORAGE_DIR, relativePath);
        logger.debug(`New path format, reading from storage root: ${filePath}`);
      }

      // Read file content, if first attempt fails and is legacy path, try new path
      logger.debug(`Starting to read file content`);
      let content: Buffer;
      try {
        content = await readFilePromise(filePath);
        logger.debug(`File content read complete, size: ${content.length} bytes`);
      } catch (firstError) {
        if (isLegacyAttempt) {
          // If legacy path read fails, try reading from new path
          const fallbackPath = join(this.app.appStoragePath, FILE_STORAGE_DIR, relativePath);
          logger.debug(
            `Legacy path read failed, attempting fallback to storage root: ${fallbackPath}`,
          );
          try {
            content = await readFilePromise(fallbackPath);
            filePath = fallbackPath; // Update filePath for subsequent metadata reading
            logger.debug(`Fallback read successful, size: ${content.length} bytes`);
          } catch (fallbackError) {
            logger.error(
              `Both legacy and fallback paths failed. Legacy error: ${(firstError as Error).message}, Fallback error: ${(fallbackError as Error).message}`,
            );
            throw firstError; // 抛出原始错误
          }
        } else {
          throw firstError;
        }
      }

      // Read metadata to get MIME type
      const metaFilePath = `${filePath}.meta`;
      let mimeType = 'application/octet-stream'; // Default MIME type
      logger.debug(`Attempting to read metadata file: ${metaFilePath}`);

      try {
        const metaContent = await readFilePromise(metaFilePath, 'utf8');
        const metadata = JSON.parse(metaContent);
        mimeType = metadata.type || mimeType;
        logger.debug(`Got MIME type from metadata: ${mimeType}`);
      } catch (metaError) {
        logger.warn(
          `Failed to read metadata file: ${(metaError as Error).message}, using default MIME type`,
        );
        // If metadata file doesn't exist, try to guess MIME type from file extension
        const ext = path.split('.').pop()?.toLowerCase();
        if (ext) {
          if (['jpg', 'jpeg'].includes(ext)) mimeType = 'image/jpeg';
          else
            switch (ext) {
              case 'png': {
                mimeType = 'image/png';
                break;
              }
              case 'gif': {
                mimeType = 'image/gif';
                break;
              }
              case 'webp': {
                mimeType = 'image/webp';
                break;
              }
              case 'svg': {
                mimeType = 'image/svg+xml';
                break;
              }
              case 'pdf': {
                {
                  mimeType = 'application/pdf';
                  // No default
                }
                break;
              }
            }
          logger.debug(`Set MIME type based on file extension: ${mimeType}`);
        }
      }

      logger.info(`File retrieval successful: ${path}`);
      return {
        content: content.buffer as ArrayBuffer,
        mimeType,
      };
    } catch (error) {
      logger.error(`File retrieval failed:`, error);

      // If file not found error, throw custom FileNotFoundError
      if (error instanceof Error && error.message.includes('ENOENT')) {
        throw new FileNotFoundError(`File not found: ${path}`, path);
      }

      throw new Error(`File retrieval failed: ${(error as Error).message}`);
    }
  }

  /**
   * Delete file
   */
  async deleteFile(path: string): Promise<{ success: boolean }> {
    logger.info(`Deleting file: ${path}`);
    try {
      // 处理desktop://路径
      if (!path.startsWith('desktop://')) {
        logger.error(`Invalid desktop file path: ${path}`);
        throw new Error(`Invalid desktop file path: ${path}`);
      }

      // Normalize path format
      const normalizedPath = path.replace(/^desktop:\/+/, 'desktop://');

      // Parse path
      const relativePath = normalizedPath.replace('desktop://', '');

      // Smart routing: decide which directory to delete file from based on path format
      let filePath: string;
      let isLegacyAttempt = false;

      if (this.isLegacyPath(relativePath)) {
        // Legacy path: delete from uploads directory (backward compatibility)
        filePath = join(this.UPLOADS_DIR, relativePath);
        isLegacyAttempt = true;
        logger.debug(`Legacy path detected, deleting from uploads directory: ${filePath}`);
      } else {
        // New path: delete from FILE_STORAGE_DIR root directory
        filePath = join(this.app.appStoragePath, FILE_STORAGE_DIR, relativePath);
        logger.debug(`New path format, deleting from storage root: ${filePath}`);
      }

      // Delete file and its metadata, if first attempt fails and is legacy path, try new path
      logger.debug(`Starting file deletion`);
      try {
        await unlinkPromise(filePath);
        logger.debug(`File deletion successful`);
      } catch (firstError) {
        if (isLegacyAttempt) {
          // If legacy path deletion fails, try deleting from new path
          const fallbackPath = join(this.app.appStoragePath, FILE_STORAGE_DIR, relativePath);
          logger.debug(
            `Legacy path deletion failed, attempting fallback to storage root: ${fallbackPath}`,
          );
          try {
            await unlinkPromise(fallbackPath);
            filePath = fallbackPath; // Update filePath for subsequent metadata deletion
            logger.debug(`Fallback deletion successful`);
          } catch (fallbackError) {
            logger.error(
              `Both legacy and fallback deletion failed. Legacy error: ${(firstError as Error).message}, Fallback error: ${(fallbackError as Error).message}`,
            );
            throw firstError; // 抛出原始错误
          }
        } else {
          throw firstError;
        }
      }

      // Try to delete metadata file, but don't require it to exist
      try {
        logger.debug(`Attempting to delete metadata file`);
        await unlinkPromise(`${filePath}.meta`);
        logger.debug(`Metadata file deletion successful`);
      } catch (error) {
        logger.warn(`Failed to delete metadata file: ${(error as Error).message}`);
      }

      logger.info(`File deletion operation complete: ${path}`);
      return { success: true };
    } catch (error) {
      logger.error(`File deletion failed:`, error);
      throw new Error(`File deletion failed: ${(error as Error).message}`);
    }
  }

  /**
   * Batch delete files
   */
  async deleteFiles(paths: string[]): Promise<DeleteFilesResponse> {
    logger.info(`Batch deleting files, count: ${paths.length}`);
    const errors: { message: string; path: string }[] = [];

    // Process all deletion requests in parallel
    logger.debug(`Starting parallel deletion requests`);
    const results = await Promise.allSettled(
      paths.map(async (path) => {
        try {
          await this.deleteFile(path);
          return { path, success: true };
        } catch (error) {
          logger.warn(`Failed to delete file: ${path}, error: ${(error as Error).message}`);
          return {
            error: (error as Error).message,
            path,
            success: false,
          };
        }
      }),
    );

    // Process results
    logger.debug(`Processing batch deletion results`);
    results.forEach((result) => {
      if (result.status === 'rejected') {
        logger.error(`Unexpected error: ${result.reason}`);
        errors.push({
          message: `Unexpected error: ${result.reason}`,
          path: 'unknown',
        });
      } else if (!result.value.success) {
        errors.push({
          message: result.value.error,
          path: result.value.path,
        });
      }
    });

    const success = errors.length === 0;
    logger.info(
      `Batch deletion operation complete, success: ${success}, error count: ${errors.length}`,
    );
    return {
      success,
      ...(errors.length > 0 && { errors }),
    };
  }

  async getFilePath(path: string): Promise<string> {
    logger.debug(`Getting filesystem path: ${path}`);
    // Handle desktop:// paths
    if (!path.startsWith('desktop://')) {
      logger.error(`Invalid desktop file path: ${path}`);
      throw new Error(`Invalid desktop file path: ${path}`);
    }

    // Normalize path format
    const normalizedPath = path.replace(/^desktop:\/+/, 'desktop://');

    // Parse path
    const relativePath = normalizedPath.replace('desktop://', '');

    // Smart routing: decide which directory to get file path from based on path format
    let fullPath: string;
    if (this.isLegacyPath(relativePath)) {
      // Legacy path: get from uploads directory (backward compatibility)
      fullPath = join(this.UPLOADS_DIR, relativePath);
      logger.debug(`Legacy path detected, resolved to uploads directory: ${fullPath}`);

      // Check if file exists, if not try new path
      try {
        await fs.promises.access(fullPath, fs.constants.F_OK);
        logger.debug(`Legacy path file exists: ${fullPath}`);
      } catch {
        // If legacy path file doesn't exist, try new path
        const fallbackPath = join(this.app.appStoragePath, FILE_STORAGE_DIR, relativePath);
        logger.debug(`Legacy path file not found, trying fallback path: ${fallbackPath}`);
        try {
          await fs.promises.access(fallbackPath, fs.constants.F_OK);
          fullPath = fallbackPath;
          logger.debug(`Fallback path file exists: ${fullPath}`);
        } catch {
          // Neither path exists, return original legacy path (maintain existing behavior)
          logger.debug(
            `Neither legacy nor fallback path exists, returning legacy path: ${fullPath}`,
          );
        }
      }
    } else {
      // New path: get from FILE_STORAGE_DIR root directory
      fullPath = join(this.app.appStoragePath, FILE_STORAGE_DIR, relativePath);
      logger.debug(`New path format, resolved to storage root: ${fullPath}`);
    }

    return fullPath;
  }

  async getFileHTTPURL(path: string): Promise<string> {
    logger.debug(`Getting file HTTP URL: ${path}`);
    // Handle desktop:// paths
    if (!path.startsWith('desktop://')) {
      logger.error(`Invalid desktop file path: ${path}`);
      throw new Error(`Invalid desktop file path: ${path}`);
    }

    // Normalize path format
    const normalizedPath = path.replace(/^desktop:\/+/, 'desktop://');

    // Parse path: extract path/to/file.png from desktop://path/to/file.png
    const relativePath = normalizedPath.replace('desktop://', '');

    // Use StaticFileServerManager to get file server domain, then construct full URL
    const serverDomain = this.app.staticFileServerManager.getFileServerDomain();
    const httpURL = `${serverDomain}${LOCAL_STORAGE_URL_PREFIX}/${relativePath}`;
    logger.debug(`Generated HTTP URL: ${httpURL}`);
    return httpURL;
  }
}
