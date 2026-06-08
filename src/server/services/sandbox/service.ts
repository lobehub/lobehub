import type {
  SandboxCallToolResult,
  SandboxExportFileResult,
} from '@lobechat/builtin-tool-cloud-sandbox';
import debug from 'debug';
import { sha256 } from 'js-sha256';

import { FileModel } from '@/database/models/file';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import {
  buildSandboxFilesInitCommand,
  SANDBOX_INIT_FLAG_TTL_SEC,
  SANDBOX_INIT_MAX_FILE_SIZE,
  SANDBOX_INIT_MAX_FILES,
  SANDBOX_INIT_TIMEOUT_MS,
  type SandboxInitDownload,
} from './bootstrap';
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

  private filesInitialized = false;

  constructor(
    private readonly provider: SandboxProvider,
    private readonly options: SandboxServiceOptions,
  ) {
    this.capabilities = provider.capabilities;
    this.kind = provider.kind;
  }

  async callTool(
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<SandboxCallToolResult> {
    await this.ensureFilesInitialized();
    return this.provider.callTool(toolName, params);
  }

  /**
   * Sync the files the user uploaded in this topic/session into the sandbox the
   * first time it is used. Best-effort: any failure is swallowed so it never
   * blocks the actual tool call. Idempotency is guaranteed by an in-sandbox
   * marker file; a short-lived Redis flag lets steady-state calls skip the work.
   */
  private async ensureFilesInitialized(): Promise<void> {
    if (this.filesInitialized) return;
    this.filesInitialized = true;

    const { fileService, serverDB, topicId, userId } = this.options;
    if (!serverDB || !fileService || !topicId || !userId) return;
    if (!this.provider.capabilities.shell) return;

    const redisKey = `lobe-sandbox:files-init:${userId}:${topicId}`;

    try {
      const redis = getAgentRuntimeRedisClient();
      if (redis) {
        const done = await redis.get(redisKey).catch(() => null);
        if (done) return;
      }

      const fileModel = new FileModel(serverDB, userId);
      const files = await fileModel.findFilesToInitInSandbox(topicId);

      if (files.length === 0) {
        if (redis) await redis.set(redisKey, '1', 'EX', SANDBOX_INIT_FLAG_TTL_SEC).catch(() => {});
        return;
      }

      const capped = files
        .filter((file) => file.size <= SANDBOX_INIT_MAX_FILE_SIZE)
        .slice(0, SANDBOX_INIT_MAX_FILES);

      if (capped.length < files.length) {
        log('Sandbox file init capped %d uploaded files down to %d', files.length, capped.length);
      }

      const downloads = (
        await Promise.all(
          capped.map(async (file): Promise<SandboxInitDownload | null> => {
            const url = await fileService
              .createCachedPreSignedUrlForPreview(file.url)
              .catch(() => '');
            return url ? { name: file.name, url } : null;
          }),
        )
      ).filter((item): item is SandboxInitDownload => item !== null);

      if (downloads.length === 0) return;

      const command = buildSandboxFilesInitCommand(downloads);
      const result = await this.provider.callTool('runCommand', {
        command,
        timeout: SANDBOX_INIT_TIMEOUT_MS,
      });

      log(
        'Sandbox file init for topic %s: %d files, success=%s',
        topicId,
        downloads.length,
        result.success,
      );

      if (result.success && redis) {
        await redis.set(redisKey, '1', 'EX', SANDBOX_INIT_FLAG_TTL_SEC).catch(() => {});
      }
    } catch (error) {
      log('Sandbox file init failed for topic %s: %O', topicId, error);
    }
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
