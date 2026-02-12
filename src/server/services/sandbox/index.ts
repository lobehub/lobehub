import {
  type ISandboxService,
  type SandboxCallToolResult,
  type SandboxExportFileResult,
} from '@lobechat/builtin-tool-cloud-sandbox';
import { type CodeInterpreterToolName } from '@lobehub/market-sdk';
import debug from 'debug';
import { sha256 } from 'js-sha256';

import { FileS3 } from '@/server/modules/S3';
import { type FileService } from '@/server/services/file';
import { type MarketService } from '@/server/services/market';

const log = debug('lobe-server:sandbox-service');

export interface ServerSandboxServiceOptions {
  fileService: FileService;
  marketService: MarketService;
  topicId: string;
  userId: string;
}

/**
 * Server-side Sandbox Service
 *
 * This service implements ISandboxService for server-side execution.
 * Context (topicId, userId) is bound at construction time.
 * It uses MarketService to call sandbox tools.
 *
 * Usage:
 * - Used by BuiltinToolsExecutor when executing CloudSandbox tools on server
 * - MarketService handles authentication via trustedClientToken
 */
export class ServerSandboxService implements ISandboxService {
  private fileService: FileService;
  private marketService: MarketService;
  private topicId: string;
  private userId: string;

  constructor(options: ServerSandboxServiceOptions) {
    this.fileService = options.fileService;
    this.marketService = options.marketService;
    this.topicId = options.topicId;
    this.userId = options.userId;
  }

  /**
   * Call a sandbox tool via MarketService
   */
  async callTool(toolName: string, params: Record<string, any>): Promise<SandboxCallToolResult> {
    log('Calling sandbox tool: %s with params: %O, topicId: %s', toolName, params, this.topicId);

    try {
      const response = await this.marketService
        .getSDK()
        .plugins.runBuildInTool(toolName as CodeInterpreterToolName, params as any, {
          topicId: this.topicId,
          userId: this.userId,
        });

      log('Sandbox tool %s response: %O', toolName, response);

      if (!response.success) {
        return {
          error: {
            message: response.error?.message || 'Unknown error',
            name: response.error?.code,
          },
          result: null,
          sessionExpiredAndRecreated: false,
          success: false,
        };
      }

      return {
        result: response.data?.result,
        sessionExpiredAndRecreated: response.data?.sessionExpiredAndRecreated || false,
        success: true,
      };
    } catch (error) {
      log('Error calling sandbox tool %s: %O', toolName, error);

      return {
        error: {
          message: (error as Error).message,
          name: (error as Error).name,
        },
        result: null,
        sessionExpiredAndRecreated: false,
        success: false,
      };
    }
  }

  /**
   * Export and upload a file from sandbox to S3
   *
   * Steps:
   * 1. Generate S3 pre-signed upload URL
   * 2. Call sandbox exportFile tool to upload file
   * 3. Verify upload success and get metadata
   * 4. Create persistent file record
   */
  async exportAndUploadFile(path: string, filename: string): Promise<SandboxExportFileResult> {
    log('Exporting file: %s from path: %s, topicId: %s', filename, path, this.topicId);

    try {
      const s3 = new FileS3();

      // Use date-based sharding for privacy compliance (GDPR, CCPA)
      const today = new Date().toISOString().split('T')[0];

      // Generate a unique key for the exported file
      const key = `code-interpreter-exports/${today}/${this.topicId}/${filename}`;

      // Step 1: Generate pre-signed upload URL
      const uploadUrl = await s3.createPreSignedUrl(key);
      log('Generated upload URL for key: %s', key);

      // Step 2: Call sandbox's exportFile tool with the upload URL
      const response = await this.marketService.exportFile({
        path,
        topicId: this.topicId,
        uploadUrl,
        userId: this.userId,
      });

      log('Sandbox exportFile response: %O', response);

      if (!response.success) {
        return {
          error: { message: response.error?.message || 'Failed to export file from sandbox' },
          filename,
          success: false,
        };
      }

      const result = response.data?.result;
      const uploadSuccess = result?.success !== false;

      if (!uploadSuccess) {
        return {
          error: { message: result?.error || 'Failed to upload file from sandbox' },
          filename,
          success: false,
        };
      }

      // Step 3: Get file metadata from S3 to verify upload and get actual size
      const metadata = await s3.getFileMetadata(key);
      const fileSize = metadata.contentLength;
      const mimeType = metadata.contentType || result?.mimeType || 'application/octet-stream';

      // Step 4: Create persistent file record using FileService
      // Generate a simple hash from the key (since we don't have the actual file content)
      const fileHash = sha256(key + Date.now().toString());

      const { fileId, url } = await this.fileService.createFileRecord({
        fileHash,
        fileType: mimeType,
        name: filename,
        size: fileSize,
        url: key, // Store S3 key
      });

      log('Created file record: fileId=%s, url=%s', fileId, url);

      return {
        fileId,
        filename,
        mimeType,
        size: fileSize,
        success: true,
        url, // This is the permanent /f/:id URL
      };
    } catch (error) {
      log('Error exporting file: %O', error);

      return {
        error: { message: (error as Error).message },
        filename,
        success: false,
      };
    }
  }
}
