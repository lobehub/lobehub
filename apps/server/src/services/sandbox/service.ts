import { randomUUID } from 'node:crypto';
import posixPath from 'node:path/posix';

import {
  type SandboxCallToolResult,
  type SandboxExportFileResult,
  selectSandboxInitFiles,
} from '@lobechat/builtin-tool-cloud-sandbox';
import { getLocalImageMimeType, MAX_IMAGE_READ_BYTES } from '@lobechat/local-file-shell/read-image';
import debug from 'debug';
import { sha256 } from 'js-sha256';

import { FileModel } from '@/database/models/file';
import { redisService } from '@/server/services/redis';

import {
  buildSandboxFilesInitCommand,
  SANDBOX_INIT_TIMEOUT_MS,
  type SandboxInitDownload,
} from './bootstrap';
import {
  buildSandboxEnvironmentInitCommand,
  environmentInitRan,
  environmentInitReport,
  hasEnvironmentInitWork,
  SANDBOX_ENVIRONMENT_INIT_TIMEOUT_MS,
  withEnvironmentVariables,
} from './environmentInit';
import { EPHEMERAL_SANDBOX_KEEP_ALIVE_MS, isHeteroExecLaunch } from './ephemeralFiles';
import { isSandboxAccessDeniedError, isSandboxAuthError } from './errors';
import type {
  SandboxCommandResult,
  SandboxProvider,
  SandboxProviderCapabilities,
  SandboxProviderKind,
  SandboxService,
  SandboxServiceOptions,
} from './types';

const log = debug('lobe-server:sandbox:service');

/** `readLocalFile` is the legacy name still used by ComputerRuntime and remote sandboxes. */
const READ_FILE_TOOL_NAMES = new Set(['readFile', 'readLocalFile']);

export class SandboxMiddlewareService implements SandboxService {
  readonly capabilities: SandboxProviderCapabilities;
  readonly kind: SandboxProviderKind;

  private environmentInitialized = false;
  /** What applying the environment said, until a shell result carries it. */
  private pendingEnvironmentReport: string | undefined;
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
    // A viewer only reads what the agent left. Preparing a sandbox for work —
    // cloning the environment, syncing the topic's uploads — is the agent's
    // call to make, and a viewer's read of a recycled sandbox would otherwise
    // pay for both just to find the agent's files missing.
    if (!this.isEphemeralViewer()) {
      const report = await this.ensureEnvironmentInitialized();
      if (report) this.pendingEnvironmentReport = report;
      await this.ensureFilesInitialized();
    }

    if (READ_FILE_TOOL_NAMES.has(toolName) && typeof params.path === 'string') {
      const mimeType = getLocalImageMimeType(params.path);
      if (mimeType) return this.readSandboxImageFile(params.path, mimeType);
    }

    const result = await this.provider.callTool(
      toolName,
      this.applyEnvironmentVariables(toolName, params),
    );
    // Awaited, so a serverless request that ends with this call cannot freeze
    // the write half-done and leave the Files panel reading a stale record —
    // but bounded, so a slow Redis never holds up a step of the agent's run.
    await withinActivityBudget(this.recordEphemeralActivity(toolName, params, result));

    // Held until a shell result can carry it: a first call that lists or
    // reads files has no output to put it in, and dropping it would hide a
    // failed setup from the rest of the conversation.
    const pending = this.pendingEnvironmentReport;
    if (!pending || !SHELL_TOOLS.has(toolName)) return result;
    this.pendingEnvironmentReport = undefined;

    return withEnvironmentReport(toolName, result, pending);
  }

  /**
   * What the Files panel needs to tell a temporary sandbox that still holds
   * the agent's files from one the execution plane recycled: the execution
   * plane recreates an expired session silently, and asking it whether one is
   * alive starts one. Only a call that reached the sandbox says anything, and
   * a temporary sandbox is the only kind that can vanish with its files.
   * Best-effort: never fails the call it follows.
   */
  private async recordEphemeralActivity(
    toolName: string,
    params: Record<string, unknown>,
    result: SandboxCallToolResult,
  ): Promise<void> {
    const { activity = 'agent', topicId, userId } = this.options;
    if (!topicId || !userId || !this.isEphemeral()) return;

    try {
      if (activity === 'agent') {
        if (!result.success) return;
        await redisService.ephemeralSandbox.recordAgentActivity(userId, topicId, {
          keepAliveUntil: isHeteroExecLaunch(toolName, params)
            ? Date.now() + EPHEMERAL_SANDBOX_KEEP_ALIVE_MS
            : undefined,
        });
      } else if (result.sessionExpiredAndRecreated) {
        // Checked before success: a read of the agent's file in the new,
        // empty sandbox usually fails, and the recycle is what it found.
        await redisService.ephemeralSandbox.recordRecycled(userId, topicId);
      } else if (result.success) {
        await redisService.ephemeralSandbox.recordAlive(userId, topicId);
      }
    } catch (error) {
      log('Failed to record sandbox activity for topic %s: %O', topicId, error);
    }
  }

  private isEphemeral() {
    const { sandboxMode } = this.options;
    return !sandboxMode || sandboxMode === 'ephemeral';
  }

  /**
   * A read of a temporary sandbox's files. A folder on the drive is prepared
   * on a viewer's first call as it always was: its files are already there,
   * and the preparation only fills a folder that is still empty.
   */
  private isEphemeralViewer() {
    return this.options.activity === 'viewer' && this.isEphemeral();
  }

  /**
   * A shell call with the topic's environment variables exported in front of
   * its command, so the conversation's commands — and anything they start,
   * like a coding agent — see what the environment declares, not only its
   * clone and setup. Other tools, and calls without a string command, pass
   * through unchanged.
   */
  private applyEnvironmentVariables(
    toolName: string,
    params: Record<string, unknown>,
  ): Record<string, unknown> {
    const env = this.options.sandboxInitialization?.env;
    if (
      !env ||
      !SHELL_TOOLS.has(toolName) ||
      typeof params.command !== 'string' ||
      !params.command.trim()
    )
      return params;

    return { ...params, command: withEnvironmentVariables(params.command, env) };
  }

  /**
   * Apply the topic's environment to the working directory the first time this
   * service instance is used: clone its repository and run its setup there.
   *
   * The command itself decides whether to run: only an empty directory is
   * initialized, so a temporary sandbox is initialized each time it starts
   * empty and a folder on the drive once. Best-effort: a failure is reported,
   * never thrown, and the tool call it precedes still runs.
   *
   * Returns what the run printed when it did something, for the next shell
   * result to carry; nothing when the directory was already initialized.
   */
  private async ensureEnvironmentInitialized(): Promise<string | undefined> {
    if (this.environmentInitialized) return;
    this.environmentInitialized = true;

    const init = this.options.sandboxInitialization;
    // An environment that only declares variables has nothing to apply to the
    // folder: its variables go on each command instead.
    if (!init || !hasEnvironmentInitWork(init) || !this.provider.capabilities.shell) return;

    try {
      const result = await this.provider.callTool('runCommand', {
        command: buildSandboxEnvironmentInitCommand(init),
        timeout: SANDBOX_ENVIRONMENT_INIT_TIMEOUT_MS,
      });
      const stdout = (result.result as { stdout?: string } | null | undefined)?.stdout;
      // The command always exits cleanly, so a failed call that printed
      // nothing never reached the sandbox: said so, not passed off as a
      // folder that was already initialized.
      if (!environmentInitRan(stdout)) {
        return result.success ? undefined : environmentInitUnreachable(init.name);
      }

      log(
        'Environment %s applied for topic %s: success=%s',
        init.environmentId,
        this.options.topicId,
        result.success,
      );

      return environmentInitReport(stdout) || undefined;
    } catch (error) {
      log('Environment init failed for topic %s: %O', this.options.topicId, error);

      return environmentInitUnreachable(init.name);
    }
  }

  /**
   * Sandbox counterpart of `readLocalImageFile`: remote readers decode files as
   * UTF-8, so image bytes either fail or come back as mojibake. Upload the
   * image through the export pipeline instead and return the same
   * `{ isImage, imageUrl, imageFileId }` shape the device path produces, which
   * ComputerRuntime routes to `state.images`. Failures degrade to an
   * `[Image: name]` placeholder rather than failing the read.
   */
  private async readSandboxImageFile(
    filePath: string,
    mimeType: string,
  ): Promise<SandboxCallToolResult> {
    const filename = posixPath.basename(filePath);
    const buildResult = (content: string, extra: Record<string, unknown> = {}) => ({
      result: { content, fileType: mimeType, filename, isImage: true, ...extra },
      success: true,
    });

    if (!this.provider.capabilities.exportFile || !this.options.fileService) {
      return buildResult(
        `[Image: ${filename}] (upload unavailable — this sandbox cannot export files; the model cannot view this image)`,
      );
    }

    const exported = await this.exportAndUploadFile(filePath, filename, {
      // A visitor's image preview gets the same share provenance the upload
      // path stamps, so it never surfaces in the creator's library while
      // `/f/:id` stays openable.
      ...(this.options.agentShareVisitor
        ? { metadata: { agentShare: this.options.agentShareVisitor } }
        : {}),
      storageName: `${randomUUID()}-${filename}`,
    });

    if (!exported.success) {
      // Auth failures must stay failed so the execInSandbox route re-prompts
      // for Market auth; access-denied refusals must stop the run. Neither may
      // be softened into the upload-unavailable placeholder.
      if (isSandboxAuthError(exported.error) || isSandboxAccessDeniedError(exported.error)) {
        return { error: exported.error, result: null, success: false };
      }

      return buildResult(
        `[Image: ${filename}] (upload unavailable — ${exported.error?.message || 'export failed'}; the model cannot view this image)`,
      );
    }

    if (!exported.url) {
      return buildResult(
        `[Image: ${filename}] (upload unavailable — export failed; the model cannot view this image)`,
      );
    }

    if (exported.size !== undefined && exported.size > MAX_IMAGE_READ_BYTES) {
      return buildResult(
        `Error: Image file is too large to preview (${exported.size} bytes, limit ${MAX_IMAGE_READ_BYTES}).`,
      );
    }

    return buildResult(`[Image: ${filename}]`, {
      fileType: exported.mimeType?.startsWith('image/') ? exported.mimeType : mimeType,
      imageFileId: exported.fileId,
      imageUrl: exported.url,
    });
  }

  /**
   * Sync the files the user uploaded in this topic/session into the sandbox the
   * first time this service instance is used. Best-effort: any failure is
   * swallowed so it never blocks the actual tool call.
   *
   * Each download is guarded by an in-sandbox marker per file id, which is the
   * single source of truth for idempotency: it is a cheap no-op for files already
   * synced, a file attached later in the topic is fetched by the next call, and
   * if the sandbox session is recycled the markers disappear so the next call
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
            return url ? { id: file.id, name: file.name, url } : null;
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
    options?: {
      /** Server-owned file-record metadata, e.g. Agent Share provenance. */
      metadata?: Record<string, unknown>;
      storageName?: string;
    },
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
            ...exported.error,
            message: exported.error?.message || 'Failed to export file from sandbox',
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
        ...(options?.metadata ? { metadata: options.metadata } : {}),
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
  const sessionState = result.sessionExpiredAndRecreated
    ? { sessionExpiredAndRecreated: true }
    : {};
  if (!result.success) {
    return {
      ...sessionState,
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
    ...sessionState,
    exitCode,
    output,
    stderr,
    success,
  };
};

const SHELL_TOOLS = new Set(['execScript', 'runCommand']);

/** The most a tool call waits on the Files panel's activity record. */
const ACTIVITY_RECORD_BUDGET_MS = 1000;

const withinActivityBudget = async (work: Promise<void>) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ACTIVITY_RECORD_BUDGET_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * What the conversation is told when the initializer could not be run at all
 * — the sandbox did not answer — so a command that follows in an empty folder
 * is not mistaken for one in the checkout. Nothing was recorded, so the next
 * call tries again.
 */
const environmentInitUnreachable = (name: string) =>
  `The environment "${name}" could not be applied: the sandbox did not respond. It will be tried again on the next command.`;

/**
 * The first shell result after an environment was applied, with what applying
 * it said in front — so the conversation sees why its directory now holds a
 * checkout, or why it does not. Other tools' results are left as they are:
 * they have no output to put it in.
 */
const withEnvironmentReport = (
  toolName: string,
  result: SandboxCallToolResult,
  report: string,
): SandboxCallToolResult => {
  const payload = result.result as { stdout?: string } | null | undefined;
  if (!SHELL_TOOLS.has(toolName) || !payload || typeof payload !== 'object') return result;

  return {
    ...result,
    result: { ...payload, stdout: `[environment] ${report}\n\n${payload.stdout ?? ''}` },
  };
};
