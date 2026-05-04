import {
  type ISandboxService,
  type SandboxCallToolResult,
  type SandboxExportFileResult,
} from '@lobechat/builtin-tool-cloud-sandbox';
import { type CodeInterpreterToolName } from '@lobehub/market-sdk';
import debug from 'debug';
import { sha256 } from 'js-sha256';
import mime from 'mime';

import { fileEnv } from '@/envs/file';
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
   * 2. Upload file (via curl if S3_EXPORT_CURL_MODE is enabled, otherwise via sandbox exportFile tool)
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

      // Infer Content-Type from filename
      const contentType = mime.getType(filename) || 'application/octet-stream';

      // Check if curl mode is enabled
      if (fileEnv.S3_EXPORT_CURL_MODE) {
        return await this.exportViaCurl(s3, key, path, filename, contentType);
      }

      // Default: use sandbox's exportFile tool
      return await this.exportViaTool(s3, key, path, filename, contentType);
    } catch (error) {
      log('Error exporting file: %O', error);

      return {
        error: { message: (error as Error).message },
        filename,
        success: false,
      };
    }
  }

  /**
   * Export file using sandbox's built-in exportFile tool
   */
  private async exportViaTool(
    s3: FileS3,
    key: string,
    path: string,
    filename: string,
    contentType: string,
  ): Promise<SandboxExportFileResult> {
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

    return await this.createFileRecord(s3, key, filename, contentType, result?.mimeType);
  }

  /**
   * Export file using curl command (compatibility mode for S3 providers with signature issues)
   */
  private async exportViaCurl(
    s3: FileS3,
    key: string,
    path: string,
    filename: string,
    contentType: string,
  ): Promise<SandboxExportFileResult> {
    log('Using curl mode for file export: %s from path: %s', filename, path);

    // Step 1: Verify file exists
    const statResponse = await this.marketService.getSDK().plugins.runBuildInTool(
      'runCommand',
      {
        command: `stat -c%s "${path}" 2>&1`,
        timeout: 5000,
      } as any,
      { topicId: this.topicId, userId: this.userId },
    );

    const statOutput = statResponse.data?.result?.stdout?.trim();

    if (!statResponse.success || !statOutput) {
      return {
        error: { message: `File not found: ${path}` },
        filename,
        success: false,
      };
    }

    const fileSize = parseInt(statOutput, 10);

    if (fileSize === 0) {
      return {
        error: { message: 'File is empty (0 bytes)' },
        filename,
        success: false,
      };
    }

    // Step 2: Generate pre-signed upload URL with Content-Type locked
    const uploadUrl = await s3.createPreSignedUrl(key, contentType);
    log('Generated upload URL for key: %s, Content-Type: %s', key, contentType);

    // Step 2: Use curl to upload file to S3
    const curlCommand = `curl -X PUT "${uploadUrl}" -H "Content-Type: ${contentType}" --data-binary @${path}`;

    log('Running curl upload command for file: %s', filename);

    const response = await this.marketService.getSDK().plugins.runBuildInTool(
      'runCommand',
      {
        command: curlCommand,
        timeout: 60000,
      } as any,
      { topicId: this.topicId, userId: this.userId },
    );

    log('Curl upload response: %O', response);

    if (!response.success) {
      return {
        error: { message: response.error?.message || 'Failed to upload file via curl' },
        filename,
        success: false,
      };
    }

    // Check if curl actually succeeded (exit code 0)
    const curlExitCode = response.data?.result?.exitCode;
    if (curlExitCode !== 0 && curlExitCode !== undefined) {
      return {
        error: {
          message: `curl failed with exit code ${curlExitCode}: ${response.data?.result?.stdout || 'unknown error'}`,
        },
        filename,
        success: false,
      };
    }

    // Step 4: Create file record
    return await this.createFileRecord(s3, key, filename, contentType);
  }

  /**
   * Create file record after successful upload
   */
  private async createFileRecord(
    s3: FileS3,
    key: string,
    filename: string,
    contentType: string,
    resultMimeType?: string,
  ): Promise<SandboxExportFileResult> {
    const metadata = await s3.getFileMetadata(key);
    const fileSize = metadata.contentLength;
    const mimeType = metadata.contentType || resultMimeType || contentType;

    const fileHash = sha256(key + Date.now().toString());

    const { fileId, url } = await this.fileService.createFileRecord({
      fileHash,
      fileType: mimeType,
      name: filename,
      size: fileSize,
      url: key,
    });

    return {
      fileId,
      filename,
      mimeType,
      size: fileSize,
      success: true,
      url,
    };
  }
}
