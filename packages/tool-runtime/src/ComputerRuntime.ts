import {
  formatCommandOutput,
  formatCommandResult,
  formatEditResult,
  formatFileContent,
  formatFileList,
  formatFileSearchResults,
  formatGlobResults,
  formatGrepResults,
  formatKillResult,
  formatMoveResults,
  formatRenameResult,
  formatSandboxRecreation,
  formatWriteResult,
} from '@lobechat/prompts/fileSystem';
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  EditFileParams,
  EditFileState,
  GetCommandOutputParams,
  GetCommandOutputState,
  GlobFilesParams,
  GlobFilesState,
  GrepContentParams,
  GrepContentState,
  KillCommandParams,
  KillCommandState,
  ListFilesParams,
  ListFilesState,
  MoveFilesParams,
  MoveFilesState,
  ReadFileParams,
  ReadFileState,
  RenameFileParams,
  RenameFileState,
  RunCommandParams,
  RunCommandState,
  SearchFilesParams,
  SearchFilesState,
  ServiceResult,
  WriteFileParams,
  WriteFileState,
} from './types';

const MAX_AGENT_GLOB_RESULTS = 1000;

/**
 * ComputerRuntime — abstract base for computer operations (file system, shell, search).
 *
 * Subclasses implement `callService` to delegate to their specific backend
 * (Electron IPC, cloud sandbox API, etc.). The base class handles:
 * - Normalizing raw results into formatted content via `@lobechat/prompts`
 * - Building consistent state objects for UI rendering
 */
export abstract class ComputerRuntime {
  /**
   * Whether this backend's `getCommandOutput` manifest exposes a `timeout`, so
   * a still-running observation may tell the reader to wait longer in one call
   * rather than poll. Opt-in: the advice is only useful where the schema the
   * model is holding actually carries the parameter.
   */
  protected readonly supportsObservationTimeout: boolean = false;

  /**
   * Call the underlying service to execute a tool.
   * Each subclass maps this to its own transport (IPC, HTTP, tRPC, etc.).
   */
  protected abstract callService(
    toolName: string,
    params: Record<string, any>,
  ): Promise<ServiceResult>;

  // ==================== File Operations ====================

  async listFiles(args: ListFilesParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callService('listLocalFiles', args);

      if (!result.success) {
        return this.errorOutput(result, { files: [], totalCount: 0 }, true);
      }

      const files = result.result?.files || [];
      const totalCount = result.result?.totalCount;

      const state: ListFilesState = { files, totalCount };

      const content = formatFileList({
        directory: args.directoryPath,
        files: files.map((f: { isDirectory: boolean; name: string }) => ({
          isDirectory: f.isDirectory,
          name: f.name,
        })),
        sortBy: args.sortBy,
        sortOrder: args.sortOrder,
        totalCount,
      });

      return { content, state, success: true };
    } catch (error) {
      return this.handleError(error, true);
    }
  }

  async readFile(args: ReadFileParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callService('readLocalFile', args);

      if (!result.success) {
        return this.errorOutput(
          result,
          {
            content: '',
            endLine: args.endLine,
            path: args.path,
            startLine: args.startLine,
          },
          true,
        );
      }

      const r = result.result || {};

      // Image file: `local-file-shell`'s readLocalFile refuses binary, so the
      // IPC layer uploads the bytes to file storage and returns a durable
      // reference instead. Carry it on `state.images` — the MessageContent
      // tool-message processor turns the uploaded URL into an `image_url`
      // part so vision-capable models can actually see the image.
      if (r.isImage && r.imageUrl) {
        const filename = r.filename || args.path;
        const placeholder = r.content || `[Image: ${filename}]`;
        const state: ReadFileState = {
          content: placeholder,
          filename,
          fileType: r.fileType,
          images: [
            { fileId: r.imageFileId, mediaType: r.fileType || 'image/png', url: r.imageUrl },
          ],
          path: args.path,
        };

        return {
          content: placeholder,
          state,
          success: true,
        };
      }

      const fileContent = r.content || '';

      const state: ReadFileState = {
        charCount: r.charCount ?? fileContent.length,
        content: fileContent,
        endLine: args.endLine,
        fileType: r.fileType,
        filename: r.filename,
        loc: r.loc,
        path: args.path,
        startLine: args.startLine,
        totalCharCount: r.totalCharCount,
        totalLines: r.totalLineCount ?? r.totalLines,
        truncated: r.truncated === true ? true : undefined,
      };

      // Number every returned line (1-based gutter) and, when the window
      // stops before EOF, prefix a `(lines 1-1000 of 2545)` marker. Rendering
      // only the caller-supplied args here meant a default-window read looked
      // identical to a full read, and the model had to burn extra turns
      // discovering the file was truncated.
      const hasLoc = Array.isArray(r.loc) && r.loc.length === 2;
      // The loc-less fallback is the cloud sandbox path (local reads always
      // return `loc`): its `startLine`/`endLine` args are 1-based inclusive
      // and independently optional, so normalize to the 0-based
      // end-exclusive window the formatter computes with — passing [1, 200]
      // through raw would label a full 200-line read as "(lines 1-199 of
      // ...)". An endLine-only read stops mid-file and needs the marker; a
      // startLine-only read runs to EOF (window end = totalLines).
      const fallbackEnd = args.endLine ?? r.totalLineCount ?? r.totalLines;
      const lineRange: [number, number] | undefined = hasLoc
        ? [r.loc[0], r.loc[1]]
        : (args.startLine !== undefined || args.endLine !== undefined) && fallbackEnd !== undefined
          ? [Math.max((args.startLine ?? 1) - 1, 0), fallbackEnd]
          : undefined;

      // `loc` is 0-based end-exclusive while the cloud sandbox's
      // `startLine`/`endLine` args are 1-based inclusive; either way the first
      // returned line's 1-based number is loc[0] + 1 or startLine.
      const firstLineNumber = hasLoc ? r.loc[0] + 1 : (args.startLine ?? 1);

      const content = formatFileContent({
        content: fileContent,
        firstLineNumber,
        lineRange,
        totalLines: r.totalLineCount ?? r.totalLines,
        // When the service cut the content at its char cap, the window's tail
        // was never delivered — a "(lines 1-1000 of N)" marker would claim
        // coverage the payload doesn't have, so it is suppressed.
        truncated: r.truncated === true,
      });

      return { content, state, success: true };
    } catch (error) {
      return this.handleError(error, true);
    }
  }

  async writeFile(args: WriteFileParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callService('writeLocalFile', args);

      if (!result.success) {
        return this.errorOutput(result, { path: args.path, success: false });
      }

      const state: WriteFileState = {
        bytesWritten: result.result?.bytesWritten,
        path: args.path,
        success: true,
      };

      const content = formatWriteResult({ path: args.path, success: true });

      return { content, state, success: true };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async editFile(args: EditFileParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callService('editLocalFile', args);

      if (!result.success) {
        return this.errorOutput(result, { path: args.path, replacements: 0 });
      }

      const state: EditFileState = {
        diffText: result.result?.diffText,
        linesAdded: result.result?.linesAdded,
        linesDeleted: result.result?.linesDeleted,
        path: args.path,
        replacements: result.result?.replacements || 0,
      };

      const content = formatEditResult({
        filePath: args.path,
        linesAdded: state.linesAdded,
        linesDeleted: state.linesDeleted,
        replacements: state.replacements,
      });

      return { content, state, success: true };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async searchFiles(args: SearchFilesParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callService('searchLocalFiles', args);

      if (!result.success) {
        return this.errorOutput(result, { results: [], totalCount: 0 }, true);
      }

      const rawResults = result.result?.results || result.result;
      const results = Array.isArray(rawResults) ? rawResults : [];
      const state: SearchFilesState = {
        results,
        totalCount: result.result?.totalCount || results.length,
      };

      const content = formatFileSearchResults(
        results.map((r: { path: string }) => ({ path: r.path })),
      );

      return { content, state, success: true };
    } catch (error) {
      return this.handleError(error, true);
    }
  }

  async moveFiles(args: MoveFilesParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callService('moveLocalFiles', args);

      if (!result.success) {
        return this.errorOutput(result, {
          results: [],
          successCount: 0,
          totalCount: args.operations.length,
        });
      }

      const rawResults = result.result?.results || result.result;
      const results = Array.isArray(rawResults) ? rawResults : [];
      const successCount =
        result.result?.successCount ??
        results.filter((r: { success: boolean }) => r.success).length;

      const state: MoveFilesState = {
        results,
        successCount,
        totalCount: args.operations.length,
      };

      const content = formatMoveResults(results);

      return { content, state, success: true };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async renameFile(args: RenameFileParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callService('renameLocalFile', args);

      if (!result.success) {
        const errorMsg = result.error?.message || result.result?.error;
        return {
          content: formatRenameResult({
            error: errorMsg,
            newName: args.newName,
            oldPath: args.oldPath,
            success: false,
          }),
          state: {
            error: errorMsg,
            newPath: '',
            oldPath: args.oldPath,
            success: false,
          } satisfies RenameFileState,
          success: true,
        };
      }

      const state: RenameFileState = {
        error: result.result?.error,
        newPath: result.result?.newPath || '',
        oldPath: args.oldPath,
        success: true,
      };

      const content = formatRenameResult({
        error: result.result?.error,
        newName: args.newName,
        oldPath: args.oldPath,
        success: true,
      });

      return { content, state, success: true };
    } catch (error) {
      return this.handleError(error);
    }
  }

  // ==================== Shell Commands ====================

  async runCommand(args: RunCommandParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callService('runCommand', args);
      const sessionState = result.sessionExpiredAndRecreated
        ? { sessionExpiredAndRecreated: true }
        : {};

      if (!result.success) {
        const output = this.errorOutput(result, {
          ...sessionState,
          error: result.error?.message,
          exitCode: result.result?.exitCode ?? result.result?.exit_code,
          isBackground: args.background || false,
          stderr: result.result?.stderr,
          stdout: result.result?.stdout,
          success: false,
        });
        return {
          ...output,
          content: formatSandboxRecreation(output.content, result.sessionExpiredAndRecreated),
        };
      }

      const r = result.result || {};
      const commandSuccess = typeof r.success === 'boolean' ? r.success : result.success;
      const outputFiles = r.outputFiles ?? r.output_files;

      const state: RunCommandState = {
        ...sessionState,
        commandId: r.commandId || r.shell_id,
        error: r.error,
        exitCode: r.exitCode ?? r.exit_code,
        isBackground: args.background || false,
        output: r.output,
        outputFiles,
        sandboxed: r.sandboxed,
        stderr: r.stderr,
        stdout: r.stdout,
        success: commandSuccess,
      };

      const content = formatCommandResult({
        error: r.error,
        exitCode: r.exitCode ?? r.exit_code,
        outputFiles,
        running: r.running,
        shellId: r.commandId || r.shell_id,
        signal: r.signal,
        stderr: r.stderr,
        stdout: r.stdout || r.output,
        success: commandSuccess,
      });

      return {
        content: formatSandboxRecreation(content, result.sessionExpiredAndRecreated),
        state,
        success: true,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getCommandOutput(args: GetCommandOutputParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callService('getCommandOutput', args);
      const sessionState = result.sessionExpiredAndRecreated
        ? { sessionExpiredAndRecreated: true }
        : {};

      if (!result.success) {
        const output = this.errorOutput(
          result,
          {
            ...sessionState,
            error: result.error?.message,
            success: false,
          },
          true,
        );
        return {
          ...output,
          content: formatSandboxRecreation(output.content, result.sessionExpiredAndRecreated),
        };
      }

      const r = result.result || {};
      const outputSuccess = typeof r.success === 'boolean' ? r.success : result.success;
      const outputFiles = r.outputFiles ?? r.output_files;
      const exitCode = r.exitCode ?? r.exit_code;
      // Liveness comes from the backend. The fallback is for backends that do
      // not report it and is knowingly lossy — a missing `exitCode` also
      // describes a signalled or never-spawned command — so it stays a last
      // resort. `r.running ?? false` was worse: it hard-coded "not running" for
      // every such backend, so no consumer could tell a live session from a
      // finished one.
      const running = typeof r.running === 'boolean' ? r.running : exitCode === undefined;

      const state: GetCommandOutputState = {
        ...sessionState,
        durationMs: r.durationMs ?? r.duration_ms,
        error: r.error,
        exitCode,
        outputFiles,
        running,
        signal: r.signal,
        stderr: r.stderr,
        stdout: r.stdout,
        success: outputSuccess,
      };

      const content = formatCommandOutput({
        canWaitLonger: this.supportsObservationTimeout,
        durationMs: r.durationMs ?? r.duration_ms,
        error: r.error,
        exitCode,
        filter: args.filter,
        output: r.newOutput || r.output,
        outputFiles,
        running,
        shellId: args.commandId,
        signal: r.signal,
        stderr: r.stderr,
        stdout: r.stdout,
        success: outputSuccess,
      });

      return {
        content: formatSandboxRecreation(content, result.sessionExpiredAndRecreated),
        state,
        success: true,
      };
    } catch (error) {
      return this.handleError(error, true);
    }
  }

  async killCommand(args: KillCommandParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callService('killCommand', args);

      if (!result.success) {
        return this.errorOutput(result, {
          commandId: args.commandId,
          error: result.error?.message,
          success: false,
        });
      }

      const killSuccess =
        typeof result.result?.success === 'boolean' ? result.result.success : result.success;

      const state: KillCommandState = {
        commandId: args.commandId,
        error: result.result?.error,
        success: killSuccess,
      };

      const content = formatKillResult({
        error: result.result?.error,
        shellId: args.commandId,
        success: killSuccess,
      });

      return { content, state, success: true };
    } catch (error) {
      return this.handleError(error);
    }
  }

  // ==================== Search & Find ====================

  async grepContent(args: GrepContentParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callService('grepContent', args);

      if (!result.success) {
        return this.errorOutput(
          result,
          {
            matches: [],
            pattern: args.pattern,
            totalMatches: 0,
          },
          true,
        );
      }

      const r = result.result || {};
      const matches = r.matches || [];
      const totalMatches = r.totalMatches ?? r.total_matches ?? 0;

      const state: GrepContentState = {
        matches,
        pattern: args.pattern,
        totalMatches,
      };

      const content = formatGrepResults({ matches, totalMatches });

      return { content, state, success: true };
    } catch (error) {
      return this.handleError(error, true);
    }
  }

  async globFiles(args: GlobFilesParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const requestedLimit =
        Number.isFinite(args.limit) && args.limit && args.limit > 0
          ? Math.floor(args.limit)
          : MAX_AGENT_GLOB_RESULTS;
      const result = await this.callService('globLocalFiles', {
        ...args,
        limit: Math.min(requestedLimit, MAX_AGENT_GLOB_RESULTS),
      });

      if (!result.success) {
        return this.errorOutput(
          result,
          {
            files: [],
            pattern: args.pattern,
            totalCount: 0,
          },
          true,
        );
      }

      const files = result.result?.files || [];
      const totalCount = result.result?.totalCount ?? result.result?.total_files ?? files.length;

      const state: GlobFilesState = {
        files,
        pattern: args.pattern,
        totalCount,
      };

      const content = formatGlobResults({ files, totalFiles: totalCount });

      return { content, state, success: true };
    } catch (error) {
      return this.handleError(error, true);
    }
  }

  // ==================== Helpers ====================

  protected handleError(error: unknown, retrySafe = false): BuiltinServerRuntimeOutput {
    const diagnostics =
      error && typeof error === 'object' ? (error as ServiceResult['error']) : undefined;
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Side-effecting operations may complete before a transport error. Reads
    // can use the normal error classifier to retry a transient failure.
    return {
      content: errorMessage,
      error: {
        code: diagnostics?.code,
        doc_url: diagnostics?.doc_url,
        hint: diagnostics?.hint,
        kind: retrySafe ? undefined : 'stop',
        message: errorMessage,
        name: diagnostics?.name,
        status: diagnostics?.status,
      },
      success: false,
    };
  }

  private errorOutput(
    result: ServiceResult,
    state: any,
    retrySafe = false,
  ): BuiltinServerRuntimeOutput {
    // Defensive fallback: when a service reports success: false without an
    // error object, JSON.stringify(undefined) returns the value `undefined`
    // (not the string "undefined"), which collapsed downstream into an empty
    // tool-message content while pluginState still got persisted.
    //
    // Priority chain:
    //   1. result.error.message (explicit error from service layer)
    //   2. JSON.stringify(result.error) (non-Error error objects)
    //   3. state.stderr (e.g. git commit failure — exit ≠ 0, error in stderr)
    //   4. state.error (runtime-level error message)
    //   5. [UNKNOWN_EXEC_ERROR] Tool execution failed (last-resort fallback)
    const errorText =
      result.error?.message ||
      (result.error !== undefined ? JSON.stringify(result.error) : undefined) ||
      (typeof state?.stderr === 'string' ? state.stderr : undefined) ||
      (typeof state?.error === 'string' ? state.error : undefined) ||
      '[UNKNOWN_EXEC_ERROR] Tool execution failed';

    return {
      content: errorText,
      // `success` is what the tool_end event reports as `isSuccess`, what
      // `UsageCounter.accumulateTool` counts into `usage.tools.byTool[].errors`,
      // and what the trace inspector prints as ✓/✗. Reporting `true` on this
      // path made every computer-tool failure — an old_string that isn't in the
      // file, a shell that never spawned, an unreadable path — indistinguishable
      // from a success in both the UI and the metrics: `errors` was
      // structurally pinned at 0 for the whole family. (A command that spawns
      // and exits non-zero does not come through here: `runCommand` reports it
      // on the success path via `state.success` / `exitCode`, since plenty of
      // tools exit non-zero by design.)
      //
      // `error` is what reaches `pluginError`. The Render components already
      // branch on it (EditLocalFile shows an "Edit Failed" alert); with it
      // unset a failed edit had neither a diff nor an error to draw and
      // rendered as an empty card.
      //
      // Preserve service diagnostics for the common tool-result formatter.
      // Only read-only callers may use its retry classification; a service's
      // `kind: 'retry'` must not replay an operation with possible side effects.
      error: {
        code: result.error?.code,
        doc_url: result.error?.doc_url,
        hint: result.error?.hint,
        kind: retrySafe ? undefined : 'stop',
        message: errorText,
        name: result.error?.name,
        status: result.error?.status,
      },
      state,
      success: false,
    };
  }
}
