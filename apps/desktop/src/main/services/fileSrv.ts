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
 * 文件未找到错误类
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
   * 获取旧版上传目录路径
   * @deprecated 仅用于向后兼容旧版文件访问，新文件应存储在 FILE_STORAGE_DIR 的自定义路径下
   */
  get UPLOADS_DIR() {
    return join(this.app.appStoragePath, FILE_STORAGE_DIR, 'uploads');
  }

  constructor(app) {
    super(app);
  }

  /**
   * 上传文件到本地存储
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
      // 获取当前时间戳，避免重复调用 Date.now()
      const now = Date.now();
      const date = (now / 1000 / 60 / 60).toFixed(0);

      // 使用传入的 filePath 作为文件的存储路径
      const fullStoragePath = join(this.app.appStoragePath, FILE_STORAGE_DIR, filePath);
      logger.debug(`Target file storage path: ${fullStoragePath}`);

      // 确保目标目录存在
      const targetDir = path.dirname(fullStoragePath);
      logger.debug(`Ensuring target directory exists: ${targetDir}`);
      makeSureDirExist(targetDir);

      const savedPath = fullStoragePath;
      logger.debug(`Final file save path: ${savedPath}`);

      // 根据 content 类型创建 Buffer
      let buffer: Buffer;
      if (typeof content === 'string') {
        // 来自服务端的 Base64 字符串
        buffer = Buffer.from(content, 'base64');
        logger.debug(`Creating buffer from Base64 string, size: ${buffer.length} bytes`);
      } else {
        // 来自浏览器端的 ArrayBuffer
        buffer = Buffer.from(content);
        logger.debug(`Creating buffer from ArrayBuffer, size: ${buffer.length} bytes`);
      }
      await writeFile(savedPath, buffer);

      // 写入元数据文件
      const metaFilePath = `${savedPath}.meta`;
      const metadata = {
        createdAt: now, // 使用统一的时间戳
        filename,
        hash,
        size: buffer.length,
        type,
      };
      logger.debug(`Writing metadata file: ${metaFilePath}`);
      await writeFile(metaFilePath, JSON.stringify(metadata, null, 2));

      // 返回与S3兼容的元数据格式
      const desktopPath = `desktop://${filePath}`;
      logger.info(`File upload successful: ${desktopPath}`);

      // 从路径中提取文件名和目录信息
      const parsedPath = path.parse(filePath);
      const dirname = parsedPath.dir || '';
      const savedFilename = parsedPath.base;

      return {
        metadata: {
          date, // 保持时间戳格式，用于兼容性和时间追踪
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
   * 判断路径是否为旧版格式（时间戳目录）
   *
   * 旧版路径格式: {timestamp}/{hash}.{ext} (例如: 1234567890/abc123.png)
   * 新版路径格式: 任意自定义路径 (例如: user_uploads/images/photo.png, ai_generations/image.jpg)
   *
   * @param path - 相对路径，不包含 desktop:// 前缀
   * @returns true 如果是旧版格式，false 如果是新版格式
   */
  private isLegacyPath(path: string): boolean {
    const parts = path.split('/');
    if (parts.length < 2) return false;

    // 如果第一部分是纯数字（时间戳），则认为是旧版格式
    // 时间戳格式：精确到小时的 Unix 时间戳，通常是 10 位数字
    return /^\d+$/.test(parts[0]);
  }

  /**
   * 获取文件内容
   */
  async getFile(path: string): Promise<{ content: ArrayBuffer; mimeType: string }> {
    logger.info(`Getting file content: ${path}`);
    try {
      // 处理desktop://路径
      if (!path.startsWith('desktop://')) {
        logger.error(`Invalid desktop file path: ${path}`);
        throw new Error(`Invalid desktop file path: ${path}`);
      }

      // 标准化路径格式
      // 可能收到的格式: desktop:/12345/file.png 或 desktop://12345/file.png
      const normalizedPath = path.replace(/^desktop:\/+/, 'desktop://');
      logger.debug(`Normalized path: ${normalizedPath}`);

      // 解析路径
      const relativePath = normalizedPath.replace('desktop://', '');

      // 智能路由：根据路径格式决定从哪个目录读取文件
      let filePath: string;
      let isLegacyAttempt = false;

      if (this.isLegacyPath(relativePath)) {
        // 旧版路径：从 uploads 目录读取（向后兼容）
        filePath = join(this.UPLOADS_DIR, relativePath);
        isLegacyAttempt = true;
        logger.debug(`Legacy path detected, reading from uploads directory: ${filePath}`);
      } else {
        // 新版路径：从 FILE_STORAGE_DIR 根目录读取
        filePath = join(this.app.appStoragePath, FILE_STORAGE_DIR, relativePath);
        logger.debug(`New path format, reading from storage root: ${filePath}`);
      }

      // 读取文件内容，如果第一次尝试失败且是 legacy 路径，则尝试新路径
      logger.debug(`Starting to read file content`);
      let content: Buffer;
      try {
        content = await readFilePromise(filePath);
        logger.debug(`File content read complete, size: ${content.length} bytes`);
      } catch (firstError) {
        if (isLegacyAttempt) {
          // 如果是 legacy 路径读取失败，尝试从新路径读取
          const fallbackPath = join(this.app.appStoragePath, FILE_STORAGE_DIR, relativePath);
          logger.debug(
            `Legacy path read failed, attempting fallback to storage root: ${fallbackPath}`,
          );
          try {
            content = await readFilePromise(fallbackPath);
            filePath = fallbackPath; // 更新 filePath 用于后续的元数据读取
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

      // 读取元数据获取MIME类型
      const metaFilePath = `${filePath}.meta`;
      let mimeType = 'application/octet-stream'; // 默认MIME类型
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
        // 如果元数据文件不存在，尝试从文件扩展名猜测MIME类型
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

      // 如果是文件不存在错误，抛出自定义的 FileNotFoundError
      if (error instanceof Error && error.message.includes('ENOENT')) {
        throw new FileNotFoundError(`File not found: ${path}`, path);
      }

      throw new Error(`File retrieval failed: ${(error as Error).message}`);
    }
  }

  /**
   * 删除文件
   */
  async deleteFile(path: string): Promise<{ success: boolean }> {
    logger.info(`Deleting file: ${path}`);
    try {
      // 处理desktop://路径
      if (!path.startsWith('desktop://')) {
        logger.error(`Invalid desktop file path: ${path}`);
        throw new Error(`Invalid desktop file path: ${path}`);
      }

      // 标准化路径格式
      const normalizedPath = path.replace(/^desktop:\/+/, 'desktop://');

      // 解析路径
      const relativePath = normalizedPath.replace('desktop://', '');

      // 智能路由：根据路径格式决定从哪个目录删除文件
      let filePath: string;
      let isLegacyAttempt = false;

      if (this.isLegacyPath(relativePath)) {
        // 旧版路径：从 uploads 目录删除（向后兼容）
        filePath = join(this.UPLOADS_DIR, relativePath);
        isLegacyAttempt = true;
        logger.debug(`Legacy path detected, deleting from uploads directory: ${filePath}`);
      } else {
        // 新版路径：从 FILE_STORAGE_DIR 根目录删除
        filePath = join(this.app.appStoragePath, FILE_STORAGE_DIR, relativePath);
        logger.debug(`New path format, deleting from storage root: ${filePath}`);
      }

      // 删除文件及其元数据，如果第一次尝试失败且是 legacy 路径，则尝试新路径
      logger.debug(`Starting file deletion`);
      try {
        await unlinkPromise(filePath);
        logger.debug(`File deletion successful`);
      } catch (firstError) {
        if (isLegacyAttempt) {
          // 如果是 legacy 路径删除失败，尝试从新路径删除
          const fallbackPath = join(this.app.appStoragePath, FILE_STORAGE_DIR, relativePath);
          logger.debug(
            `Legacy path deletion failed, attempting fallback to storage root: ${fallbackPath}`,
          );
          try {
            await unlinkPromise(fallbackPath);
            filePath = fallbackPath; // 更新 filePath 用于后续的元数据删除
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

      // 尝试删除元数据文件，但不强制要求存在
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
   * 批量删除文件
   */
  async deleteFiles(paths: string[]): Promise<DeleteFilesResponse> {
    logger.info(`Batch deleting files, count: ${paths.length}`);
    const errors: { message: string; path: string }[] = [];

    // 并行处理所有删除请求
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

    // 处理结果
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
    // 处理desktop://路径
    if (!path.startsWith('desktop://')) {
      logger.error(`Invalid desktop file path: ${path}`);
      throw new Error(`Invalid desktop file path: ${path}`);
    }

    // 标准化路径格式
    const normalizedPath = path.replace(/^desktop:\/+/, 'desktop://');

    // 解析路径
    const relativePath = normalizedPath.replace('desktop://', '');

    // 智能路由：根据路径格式决定从哪个目录获取文件路径
    let fullPath: string;
    if (this.isLegacyPath(relativePath)) {
      // 旧版路径：从 uploads 目录获取（向后兼容）
      fullPath = join(this.UPLOADS_DIR, relativePath);
      logger.debug(`Legacy path detected, resolved to uploads directory: ${fullPath}`);

      // 检查文件是否存在，如果不存在则尝试新路径
      try {
        await fs.promises.access(fullPath, fs.constants.F_OK);
        logger.debug(`Legacy path file exists: ${fullPath}`);
      } catch {
        // 如果 legacy 路径文件不存在，尝试新路径
        const fallbackPath = join(this.app.appStoragePath, FILE_STORAGE_DIR, relativePath);
        logger.debug(`Legacy path file not found, trying fallback path: ${fallbackPath}`);
        try {
          await fs.promises.access(fallbackPath, fs.constants.F_OK);
          fullPath = fallbackPath;
          logger.debug(`Fallback path file exists: ${fullPath}`);
        } catch {
          // 两个路径都不存在，返回原始的 legacy 路径（保持原有行为）
          logger.debug(
            `Neither legacy nor fallback path exists, returning legacy path: ${fullPath}`,
          );
        }
      }
    } else {
      // 新版路径：从 FILE_STORAGE_DIR 根目录获取
      fullPath = join(this.app.appStoragePath, FILE_STORAGE_DIR, relativePath);
      logger.debug(`New path format, resolved to storage root: ${fullPath}`);
    }

    return fullPath;
  }

  async getFileHTTPURL(path: string): Promise<string> {
    logger.debug(`Getting file HTTP URL: ${path}`);
    // 处理desktop://路径
    if (!path.startsWith('desktop://')) {
      logger.error(`Invalid desktop file path: ${path}`);
      throw new Error(`Invalid desktop file path: ${path}`);
    }

    // 标准化路径格式
    const normalizedPath = path.replace(/^desktop:\/+/, 'desktop://');

    // 解析路径：从 desktop://path/to/file.png 中提取 path/to/file.png
    const relativePath = normalizedPath.replace('desktop://', '');

    // 使用 StaticFileServerManager 获取文件服务器域名，然后构建完整 URL
    const serverDomain = this.app.staticFileServerManager.getFileServerDomain();
    const httpURL = `${serverDomain}${LOCAL_STORAGE_URL_PREFIX}/${relativePath}`;
    logger.debug(`Generated HTTP URL: ${httpURL}`);
    return httpURL;
  }
}
