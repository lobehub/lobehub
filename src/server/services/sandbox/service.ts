import type {
  SandboxCallToolResult,
  SandboxExportFileResult,
} from '@lobechat/builtin-tool-cloud-sandbox';
import debug from 'debug';
import { sha256 } from 'js-sha256';

import type {
  SandboxCommandResult,
  SandboxProvider,
  SandboxProviderCapabilities,
  SandboxProviderKind,
  SandboxService,
  SandboxServiceOptions,
} from './types';

const log = debug('lobe-server:sandbox:service');

export class SandboxMiddlewareService implements SandboxService {
  readonly capabilities: SandboxProviderCapabilities;
  readonly kind: SandboxProviderKind;

  constructor(
    private readonly provider: SandboxProvider,
    private readonly options: SandboxServiceOptions,
  ) {
    this.capabilities = provider.capabilities;
    this.kind = provider.kind;
  }

  callTool(toolName: string, params: Record<string, unknown>): Promise<SandboxCallToolResult> {
    return this.provider.callTool(toolName, params);
  }

  async exportAndUploadFile(path: string, filename: string): Promise<SandboxExportFileResult> {
    const { fileService, topicId } = this.options;

    if (!fileService) {
      return {
        error: { message: 'fileService is required for sandbox file export' },
        filename,
        success: false,
      };
    }

    log('Exporting file: %s from path: %s, topicId: %s', filename, path, topicId);

    try {
      const now = Date.now();
      const today = new Date(now).toISOString().split('T')[0];
      const key = `code-interpreter-exports/${today}/${topicId}/${filename}`;
      const upload = await fileService.createPreSignedUpload(key);

      const exported = await this.provider.exportFileToUploadUrl({
        filename,
        path,
        uploadHeaders: upload.headers,
        uploadUrl: upload.url,
      });

      if (!exported.success) {
        return {
          error: {
            message: exported.error?.message || 'Failed to export file from sandbox',
            name: exported.error?.name,
          },
          filename,
          success: false,
        };
      }

      const metadata = await fileService.getFileMetadata(key);
      const fileSize = metadata.contentLength;
      const mimeType =
        metadata.contentType ||
        exported.mimeType ||
        String(exported.result?.mimeType || '') ||
        String(exported.result?.mime_type || '') ||
        'application/octet-stream';
      const fileHash = sha256(key + now.toString());

      const { fileId, url } = await fileService.createFileRecord({
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

export const normalizeSandboxCommandResult = (
  result: SandboxCallToolResult,
): SandboxCommandResult => {
  if (!result.success) {
    return {
      exitCode: 1,
      output: '',
      stderr: result.error?.message || 'Command execution failed',
      success: false,
    };
  }

  const raw = result.result || {};
  const rawExitCode = raw.exitCode ?? raw.exit_code;
  const exitCode = typeof rawExitCode === 'number' ? rawExitCode : 0;
  const output = String(raw.stdout || raw.output || '');
  const stderr = raw.stderr === undefined ? undefined : String(raw.stderr);
  const success = typeof raw.success === 'boolean' ? raw.success : exitCode === 0;

  return {
    exitCode,
    output,
    stderr,
    success,
  };
};
