import { type CodeInterpreterToolName } from '@lobehub/market-sdk';
import {
  type ISandboxService,
  type SandboxCallToolResult,
  type SandboxExportFileResult,
} from '@lobechat/builtin-tool-cloud-sandbox';
import debug from 'debug';

import { MarketService } from '@/server/services/market';

const log = debug('lobe-server:sandbox-service');

export interface ServerSandboxServiceOptions {
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
  private marketService: MarketService;
  private topicId: string;
  private userId: string;

  constructor(options: ServerSandboxServiceOptions) {
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
      const response = await this.marketService.getSDK().plugins.runBuildInTool(
        toolName as CodeInterpreterToolName,
        params as any,
        { topicId: this.topicId, userId: this.userId },
      );

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
   * Export and upload a file from sandbox
   *
   * Note: This is a simplified version for server-side use.
   * The full implementation with S3 upload is in the tRPC router.
   */
  async exportAndUploadFile(path: string, filename: string): Promise<SandboxExportFileResult> {
    log('Exporting file: %s from path: %s, topicId: %s', filename, path, this.topicId);

    // For server-side, we need to call the exportFile tool
    // The full S3 upload logic should be handled separately
    // This is a basic implementation that can be extended

    try {
      return {
        error: {
          message:
            'Server-side file export not fully implemented. Use tRPC endpoint for file exports.',
        },
        filename,
        success: false,
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
