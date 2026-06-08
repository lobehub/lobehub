import type { SandboxCallToolResult } from '@lobechat/builtin-tool-cloud-sandbox';
import type { CodeInterpreterToolName } from '@lobehub/market-sdk';
import debug from 'debug';
import mime from 'mime';

import { fileEnv } from '@/envs/file';

import { SandboxMiddlewareService } from '../service';
import type {
  SandboxProvider,
  SandboxProviderCapabilities,
  SandboxProviderFileExportRequest,
  SandboxProviderFileExportResult,
  SandboxService,
  SandboxServiceOptions,
} from '../types';

const log = debug('lobe-server:sandbox:market');
const REDACTED_SANDBOX_PARAM = '[redacted]';
const SANDBOX_AUTH_ENV_PATTERN = /\b(LOBEHUB_JWT|GITHUB_TOKEN)=("[^"]*"|'[^']*'|\S+)/g;

export class MarketSandboxProvider implements SandboxProvider {
  readonly capabilities = {
    backgroundCommands: true,
    exportFile: true,
    files: true,
    languages: ['python', 'javascript', 'typescript'],
    persistentSession: true,
    shell: true,
    skillScripts: true,
  } as const satisfies SandboxProviderCapabilities;

  readonly kind = 'market';

  private readonly options: SandboxServiceOptions;

  constructor(options: SandboxServiceOptions) {
    this.options = options;
  }

  async callTool(
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<SandboxCallToolResult> {
    const { marketService, topicId, userId } = this.options;

    log(
      'Calling sandbox tool: %s with params: %O, topicId: %s',
      toolName,
      redactSandboxParams(params),
      topicId,
    );

    try {
      const response = await marketService
        .getSDK()
        .plugins.runBuildInTool(toolName as CodeInterpreterToolName, params as never, {
          topicId,
          userId,
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

  async exportFileToUploadUrl({
    filename,
    path,
    uploadUrl,
    uploadHeaders,
  }: SandboxProviderFileExportRequest): Promise<SandboxProviderFileExportResult> {
    const { marketService, topicId, userId } = this.options;

    // Use curl mode if enabled (for S3 providers with signature issues)
    if (fileEnv.S3_EXPORT_CURL_MODE) {
      return this.exportViaCurl({ filename, path, uploadUrl, uploadHeaders });
    }

    try {
      const response = await marketService.exportFile({
        path,
        topicId,
        uploadUrl,
        userId,
      });

      log('Sandbox exportFile response: %O', response);

      if (!response.success) {
        return {
          error: {
            message: response.error?.message || 'Failed to export file from sandbox',
            name: response.error?.code,
          },
          success: false,
        };
      }

      const result = response.data?.result;
      const uploadSuccess = result?.success !== false;

      if (!uploadSuccess) {
        return {
          error: { message: result?.error || 'Failed to upload file from sandbox' },
          success: false,
        };
      }

      return {
        mimeType: result?.mimeType,
        result,
        success: true,
      };
    } catch (error) {
      log('Error exporting file: %O', error);

      return {
        error: { message: (error as Error).message },
        success: false,
      };
    }
  }

  private async exportViaCurl({
    path,
    uploadUrl,
    uploadHeaders,
  }: SandboxProviderFileExportRequest): Promise<SandboxProviderFileExportResult> {
    const { marketService, topicId, userId } = this.options;

    log('Using curl mode for file export from path: %s', path);

    try {
      // Step 1: Verify file exists and get size
      const statResponse = await marketService.getSDK().plugins.runBuildInTool(
        'runCommand',
        {
          command: `stat -c%s "${path}" 2>&1`,
          timeout: 5000,
        } as never,
        { topicId, userId },
      );

      const statOutput = statResponse.data?.result?.stdout?.trim();

      if (!statResponse.success || !statOutput) {
        return {
          error: { message: `File not found: ${path}` },
          success: false,
        };
      }

      const fileSize = parseInt(statOutput, 10);

      if (fileSize === 0) {
        return {
          error: { message: 'File is empty (0 bytes)' },
          success: false,
        };
      }

      // Step 2: Get file extension and infer content type
      const filename = path.split('/').pop() || 'file';
      const contentType = mime.getType(filename) || 'application/octet-stream';

      // Step 3: Build curl command with headers
      const headerArgs: string[] = [];
      if (uploadHeaders) {
        for (const [key, value] of Object.entries(uploadHeaders)) {
          headerArgs.push(`-H "${key}: ${value}"`);
        }
      }
      headerArgs.push(`-H "Content-Type: ${contentType}"`);

      const curlCommand = `curl -X PUT "${uploadUrl}" ${headerArgs.join(' ')} --data-binary @${path}`;

      log('Running curl upload command for file: %s', filename);

      const response = await marketService.getSDK().plugins.runBuildInTool(
        'runCommand',
        {
          command: curlCommand,
          timeout: 60000,
        } as never,
        { topicId, userId },
      );

      log('Curl upload response: %O', response);

      if (!response.success) {
        return {
          error: { message: response.error?.message || 'Failed to upload file via curl' },
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
          success: false,
        };
      }

      return {
        mimeType: contentType,
        success: true,
      };
    } catch (error) {
      log('Error exporting file via curl: %O', error);

      return {
        error: { message: (error as Error).message },
        success: false,
      };
    }
  }
}

export const redactSandboxParams = (params: Record<string, unknown>) => {
  const hasCommand = typeof params.command === 'string';
  if (!params.skillZipUrls && !params.zipUrl && !hasCommand) return params;

  const redacted = {
    ...params,
  };

  if (params.zipUrl) redacted.zipUrl = REDACTED_SANDBOX_PARAM;
  if (params.skillZipUrls) redacted.skillZipUrls = REDACTED_SANDBOX_PARAM;
  if (typeof params.command === 'string') {
    redacted.command = params.command.replaceAll(
      SANDBOX_AUTH_ENV_PATTERN,
      (_, name: string) => `${name}=${REDACTED_SANDBOX_PARAM}`,
    );
  }

  return redacted;
};

/** @deprecated Use createSandboxService. */
export class ServerSandboxService extends SandboxMiddlewareService implements SandboxService {
  constructor(options: SandboxServiceOptions) {
    super(new MarketSandboxProvider(options), options);
  }
}
