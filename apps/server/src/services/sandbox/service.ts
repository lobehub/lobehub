import {
  CloudSandboxIdentifier,
  type SandboxCallToolResult,
  type SandboxExportFileResult,
  selectSandboxInitFiles,
} from '@lobechat/builtin-tool-cloud-sandbox';
import debug from 'debug';
import { sha256 } from 'js-sha256';

import { FileModel } from '@/database/models/file';
import {
  checkCommand,
  type CommandGovernanceContext,
  logCommandExecution,
} from '@/server/services/governance';

import {
  buildSandboxFilesInitCommand,
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

/**
 * Sandbox tool names that spawn a shell command, and therefore are the ones
 * command governance gates. Mirrors `SHELL_TOOL_NAMES` in
 * `toolExecution/serverRuntimes/cloudSandbox.ts` (kept as a separate literal
 * rather than a shared import — that module belongs to the Agent tool-call
 * layer, this one gates every caller of `SandboxMiddlewareService`).
 */
const GOVERNED_SHELL_TOOL_NAMES = new Set(['execScript', 'runCommand']);

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

  /**
   * The single collection point for every caller of the sandbox provider —
   * the Agent tool-call path (`toolExecution/serverRuntimes/cloudSandbox.ts`)
   * and the front-end "run" path (`routers/tools/market.ts` →
   * `execInSandboxHandler`) both end up here. Command governance is gated at
   * this chokepoint rather than upstream so both paths, and both shell tool
   * names (`runCommand`/`execScript`), are covered by one check — and so a
   * new sandbox shell tool is covered automatically.
   *
   * `checkCommand`/`logCommandExecution` no-op with zero DB access when
   * `COMMAND_GOVERNANCE_ENABLED` is off, and fail open on any internal error
   * — see `services/governance/policyGate.ts`.
   */
  async callTool(
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<SandboxCallToolResult> {
    await this.ensureFilesInitialized();

    const { serverDB, userId } = this.options;

    if (!GOVERNED_SHELL_TOOL_NAMES.has(toolName) || !serverDB || !userId) {
      return this.provider.callTool(toolName, params);
    }

    const ctx: CommandGovernanceContext = {
      apiName: toolName,
      commandText:
        typeof params?.command === 'string' ? params.command : JSON.stringify(params ?? {}),
      executionTarget: 'sandbox',
      toolIdentifier: CloudSandboxIdentifier,
      userId,
    };

    const decision = await checkCommand(ctx, serverDB);

    if (!decision.allowed) {
      try {
        await logCommandExecution(ctx, { blocked: true, matchedRuleId: decision.ruleId }, serverDB);
      } catch (auditError) {
        log('Failed to record blocked-command audit log: %O', auditError);
      }

      return {
        error: {
          message:
            'This command was blocked by a command governance rule set by your administrator.',
          name: 'COMMAND_BLOCKED',
        },
        result: null,
        success: false,
      };
    }

    const startedAt = Date.now();
    const result = await this.provider.callTool(toolName, params);

    try {
      await logCommandExecution(
        ctx,
        {
          blocked: false,
          durationMs: Date.now() - startedAt,
          errorMessage: result.error?.message,
          success: result.success,
        },
        serverDB,
      );
    } catch (auditError) {
      log('Failed to record command execution audit log: %O', auditError);
    }

    return result;
  }

  /**
   * Sync the files the user uploaded in this topic/session into the sandbox the
   * first time this service instance is used. Best-effort: any failure is
   * swallowed so it never blocks the actual tool call.
   *
   * The downloaded command is guarded by an in-sandbox marker file, which is the
   * single source of truth for idempotency: it is a cheap no-op once synced, and
   * if the sandbox session is recycled the marker disappears so the next call
   * re-syncs automatically. We intentionally do NOT cache the "done" state out of
   * band (e.g. in Redis), because that could skip the re-sync after a recycle and
   * leave the agent believing files exist when /mnt/data is empty.
   */
  private async ensureFilesInitialized(): Promise<void> {
    if (this.filesInitialized) return;
    this.filesInitialized = true;

    const { fileService, serverDB, topicId, userId } = this.options;
    if (!serverDB || !fileService || !topicId || !userId) return;
    if (!this.provider.capabilities.shell) return;

    try {
      const fileModel = new FileModel(serverDB, userId);
      const files = selectSandboxInitFiles(await fileModel.findFilesToInitInSandbox(topicId));

      if (files.length === 0) return;

      const downloads = (
        await Promise.all(
          files.map(async (file): Promise<SandboxInitDownload | null> => {
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
    } catch (error) {
      log('Sandbox file init failed for topic %s: %O', topicId, error);
    }
  }

  async exportAndUploadFile(
    path: string,
    filename: string,
    options?: { storageName?: string },
  ): Promise<SandboxExportFileResult> {
    const { fileService, topicId } = this.options;

    if (!fileService) {
      return {
        error: { message: 'fileService is required for sandbox file export' },
        filename,
        success: false,
      };
    }

    // The object's storage key uses `storageName` when provided so callers can
    // guarantee a collision-proof, immutable object per (operation, path); the
    // file record's display `name` always stays the user-facing `filename`, so a
    // download never surfaces the mangled key. Defaults to `filename` for the
    // common case where display name and key are the same.
    const storageName = options?.storageName ?? filename;

    log(
      'Exporting file: %s (key: %s) from path: %s, topicId: %s',
      filename,
      storageName,
      path,
      topicId,
    );

    try {
      const now = Date.now();
      const today = new Date(now).toISOString().split('T')[0];
      const key = `code-interpreter-exports/${today}/${topicId}/${storageName}`;
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
