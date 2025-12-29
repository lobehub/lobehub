import debug from 'debug';
import { sha256 } from 'js-sha256';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { electronIpcClient } from '@/server/modules/ElectronIPCClient';
import { inferContentTypeFromImageUrl } from '@/utils/url';

import { FileServiceImpl } from './type';
import { extractKeyFromUrlOrReturnOriginal } from './utils';

const log = debug('lobe-file:desktop-local');

/**
 * Desktop application local file service implementation
 */
export class DesktopLocalFileImpl implements FileServiceImpl {
  /**
   * Get local file URL
   * Retrieve HTTP URL from main process via IPC
   */
  private async getLocalFileUrl(key: string): Promise<string> {
    try {
      return await electronIpcClient.getFileHTTPURL(key);
    } catch (e) {
      console.error('[DesktopLocalFileImpl] Failed to get file HTTP URL via IPC:', e);
      return '';
    }
  }

  /**
   * Create pre-signed upload URL (local version directly returns file path, may need further extension)
   */
  async createPreSignedUrl(key: string): Promise<string> {
    // In desktop application local file implementation, pre-signed URL is not needed
    // Directly return the file path
    return key;
  }

  /**
   * Create pre-signed preview URL (local version accesses local files via HTTP path)
   */
  async createPreSignedUrlForPreview(key: string): Promise<string> {
    return this.getLocalFileUrl(key);
  }

  async deleteFile(key: string): Promise<any> {
    // Handle legacy data compatibility - extract key from URL if needed
    const actualKey = extractKeyFromUrlOrReturnOriginal(key, this.getKeyFromFullUrl.bind(this));
    return await this.deleteFiles([actualKey]);
  }

  /**
   * Delete files in batch
   */
  async deleteFiles(keys: string[]): Promise<any> {
    try {
      if (!keys || keys.length === 0) return { success: true };

      // Handle legacy data compatibility - extract keys from URLs if needed
      const actualKeys = keys.map((key) =>
        extractKeyFromUrlOrReturnOriginal(key, this.getKeyFromFullUrl.bind(this)),
      );
      
      // Ensure all paths are valid desktop:// paths
      const invalidKeys = actualKeys.filter((key) => !key.startsWith('desktop://'));
      if (invalidKeys.length > 0) {
        console.error('Invalid desktop file paths:', invalidKeys);
        return {
          errors: invalidKeys.map((key) => ({ message: 'Invalid desktop file path', path: key })),
          success: false,
        };
      }

      // Use electronIpcClient's dedicated method
      return await electronIpcClient.deleteFiles(actualKeys);
    } catch (error) {
      console.error('Failed to delete files:', error);
      return {
        errors: [
          {
            message: `Batch delete failed: ${(error as Error).message}`,
            path: 'batch',
          },
        ],
        success: false,
      };
    }
  }

  /**
   * Get file byte array
   */
  async getFileByteArray(key: string): Promise<Uint8Array> {
    try {
      // Get absolute file path from Electron
      const filePath = await electronIpcClient.getFilePathById(key);

      // Check if file exists
      if (!existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        return new Uint8Array();
      }

      // Read file content and convert to Uint8Array
      const buffer = readFileSync(filePath);
      return new Uint8Array(buffer);
    } catch (e) {
      console.error('Failed to get file byte array:', e);
      return new Uint8Array();
    }
  }

  /**
   * Get file content
   */
  async getFileContent(key: string): Promise<string> {
    try {
      // Get absolute file path from Electron
      const filePath = await electronIpcClient.getFilePathById(key);

      // Check if file exists
      if (!existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        return '';
      }

      // Read file content and convert to string
      return readFileSync(filePath, 'utf8');
    } catch (e) {
      console.error('Failed to get file content:', e);
      return '';
    }
  }

  /**
   * Get full file URL
   */
  async getFullFileUrl(url?: string | null): Promise<string> {
    if (!url) return '';

    // Handle legacy data compatibility using shared utility
    const key = extractKeyFromUrlOrReturnOriginal(url, this.getKeyFromFullUrl.bind(this));

    return this.getLocalFileUrl(key);
  }

  /**
   * Upload content
   * Note: This feature may require extension of Electron IPC interface
   */
  async uploadContent(filePath: string, content: string): Promise<any> {
    // Need to extend electronIpcClient to support uploading file content
    // For example: return electronIpcClient.uploadContent(filePath, content);
    console.warn('uploadContent not implemented for Desktop local file service', filePath, content);
    return;
  }

  /**
   * Extract key from full URL
   * Extract desktop:// format path from HTTP URL
   */
  getKeyFromFullUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathSegments = urlObj.pathname.split('/').filter((segment) => segment !== '');

      // Remove first path segment (desktop-file)
      pathSegments.shift();

      // Recombine remaining path segments
      const filePath = pathSegments.join('/');

      // Return desktop:// format path
      return `desktop://${filePath}`;
    } catch (e) {
      console.error('[DesktopLocalFileImpl] Failed to extract key from URL:', e);
      return '';
    }
  }

  /**
   * Upload media file
   */
  async uploadMedia(key: string, buffer: Buffer): Promise<{ key: string }> {
    try {
      // Convert Buffer to Base64 string
      const content = buffer.toString('base64');

      // Extract filename from key
      const filename = path.basename(key);

      // Calculate SHA256 hash of the file
      const hash = sha256(buffer);

      // Infer MIME type from file URL
      const type = inferContentTypeFromImageUrl(key)!;

      // Construct upload parameters
      const uploadParams = {
        content,
        filename,
        hash,
        path: key,
        type,
      };

      // Call electronIpcClient to upload file
      const result = await electronIpcClient.createFile(uploadParams);

      if (!result.success) {
        throw new Error('Failed to upload file via Electron IPC');
      }

      log('File uploaded successfully: %O', result.metadata);
      return { key: result.metadata.path };
    } catch (error) {
      console.error('[DesktopLocalFileImpl] Failed to upload media file:', error);
      throw error;
    }
  }
}
