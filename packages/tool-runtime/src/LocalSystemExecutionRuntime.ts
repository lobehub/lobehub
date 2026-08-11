import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import { ComputerRuntime } from './ComputerRuntime';
import { resolveArgsWithScope, resolvePathWithScope } from './pathScope';
import type { ServiceResult } from './types';

/**
 * Service interface for local system operations.
 * Abstracts the Electron IPC layer so the runtime is testable and decoupled.
 */
export interface ILocalSystemService {
  editLocalFile: (params: any) => Promise<any>;
  getCommandOutput: (params: any) => Promise<any>;
  globFiles: (params: any) => Promise<any>;
  grepContent: (params: any) => Promise<any>;
  killCommand: (params: any) => Promise<any>;
  listLocalFiles: (params: any) => Promise<any>;
  moveLocalFiles: (params: any) => Promise<any>;
  readLocalFile: (params: any) => Promise<any>;
  readLocalFiles: (params: any) => Promise<any>;
  renameLocalFile: (params: any) => Promise<any>;
  runCommand: (params: any) => Promise<any>;
  searchLocalFiles: (params: any) => Promise<any>;
  writeFile: (params: any) => Promise<any>;
}

/**
 * Maps IPC tool names to localFileService method names.
 * IPC service uses different method names than the standard tool names.
 */
const SERVICE_METHOD_MAP: Record<string, keyof ILocalSystemService> = {
  editLocalFile: 'editLocalFile',
  getCommandOutput: 'getCommandOutput',
  globLocalFiles: 'globFiles',
  grepContent: 'grepContent',
  killCommand: 'killCommand',
  listLocalFiles: 'listLocalFiles',
  moveLocalFiles: 'moveLocalFiles',
  readLocalFile: 'readLocalFile',
  renameLocalFile: 'renameLocalFile',
  runCommand: 'runCommand',
  searchLocalFiles: 'searchLocalFiles',
  writeLocalFile: 'writeFile',
};

/**
 * Legacy API name aliases used by older gateway versions. Normalized to the
 * current tool names before dispatch.
 */
const LEGACY_API_ALIASES: Record<string, string> = {
  editLocalFile: 'editFile',
  globLocalFiles: 'globFiles',
  listLocalFiles: 'listFiles',
  moveLocalFiles: 'moveFiles',
  readLocalFile: 'readFile',
  renameLocalFile: 'renameFile',
  searchLocalFiles: 'searchFiles',
  writeLocalFile: 'writeFile',
};

/**
 * Default cap for glob/search results when the caller didn't ask for a limit.
 * Matches the manifest's documented default.
 */
const DEFAULT_FILE_SEARCH_LIMIT = 100;

const normalizeLimit = (limit?: number) =>
  Number.isFinite(limit) && limit && limit > 0 ? Math.floor(limit) : DEFAULT_FILE_SEARCH_LIMIT;

export interface ExecuteLocalToolOptions {
  /**
   * Whether `args.cwd` may be trusted as a search/spawn root.
   *
   * `cwd` is not a manifest field for any api, so a model can never legitimately
   * set one — but the gateway and CLI paths receive args that the server runtime
   * already sanitized (it strips every inbound `cwd` and re-injects the
   * device-bound value; see `serverRuntimes/localSystem.ts`), and that injected
   * value has to survive.
   *
   * Callers must state which side of that boundary they are on rather than
   * letting the runtime infer it: a renderer call for an agent with no
   * configured working directory is indistinguishable from a gateway call if the
   * runtime only looks at whether `workingDirectory` is set.
   *
   * @default false
   */
  trustArgsCwd?: boolean;
  /**
   * The agent's effective working directory (absolute). Sourced from the same
   * place as the `{{workingDirectory}}` prompt placeholder, so what tools
   * operate on matches what the prompt promises.
   */
  workingDirectory?: string;
}

/**
 * Local System Execution Runtime
 *
 * Extends ComputerRuntime for standard computer operations via Electron IPC.
 * Normalizes snake_case IPC results (exit_code, shell_id, total_matches)
 * into the camelCase format expected by ComputerRuntime.
 */
export class LocalSystemExecutionRuntime extends ComputerRuntime {
  private service: ILocalSystemService;

  constructor(service: ILocalSystemService) {
    super();
    this.service = service;
  }

  /**
   * Single entry point for dispatching a raw tool call (manifest / IPC shaped
   * args, snake_case field names) to the typed ComputerRuntime methods.
   *
   * This is THE place where three concerns converge — every caller (renderer
   * executor, desktop gateway, CLI) used to keep its own partial copy of them,
   * which is how the "half-fixed cwd injection" family of bugs happened:
   *
   * 1. **Legacy alias normalization** — older gateways send `readLocalFile`
   *    etc.; normalized to the current tool names.
   * 2. **Working-directory anchoring** — mirrors the server runtime's
   *    `WORKING_DIR_ARG` injection. Shell + file ops get `cwd`, search ops get
   *    their search root resolved via {@link resolvePathWithScope}. Without it
   *    the service layer falls back to its own `process.cwd()` — the app
   *    install directory in a packaged desktop app (or `/`), NOT the user's
   *    workspace. Server-injected values already present in `args` win: they
   *    are resolved against the working directory rather than replaced.
   * 3. **Field mapping** — IPC names (`file_path`, `shell_id`,
   *    `run_in_background`, `loc`) → the normalized names ComputerRuntime
   *    reads when building state/content. `denormalizeParams` maps them back
   *    to IPC names right before the service call.
   *
   * Returns `null` when `apiName` is not a local-system tool so callers can
   * fall back to their own tools (platform agents, browser, …).
   */
  async executeToolCall(
    apiName: string,
    args: Record<string, any>,
    options?: ExecuteLocalToolOptions,
  ): Promise<BuiltinServerRuntimeOutput | null> {
    const name = LEGACY_API_ALIASES[apiName] ?? apiName;
    const workingDirectory = options?.workingDirectory;
    // Trust boundary — `cwd` is never a manifest field, so no legitimate call
    // carries a model-chosen one, and the out-of-scope intervention audit does
    // not inspect it (it reads `path`/`file_path`/`directory`/`scope`). Left
    // trusted, `readFile({ path: 'passwd', cwd: '/etc' })` would look
    // workspace-relative to the audit and then execute against `/etc`.
    //
    // Which side of the boundary a call is on comes from the caller's explicit
    // `trustArgsCwd`, never from whether `workingDirectory` happens to be set:
    // a renderer call for an agent with no configured working directory leaves
    // both undefined, and inferring "no workingDirectory ⇒ server-sanitized"
    // would hand that call the model's own `cwd`.
    const trustedArgsCwd = options?.trustArgsCwd ? args.cwd : undefined;
    const cwd = workingDirectory ?? trustedArgsCwd;

    switch (name) {
      case 'listFiles': {
        return this.listFiles({
          cwd,
          directoryPath: args.path,
          limit: args.limit,
          sortBy: args.sortBy,
          sortOrder: args.sortOrder,
        });
      }

      case 'readFile': {
        return this.readFile({
          cwd,
          endLine: args.loc?.[1],
          path: args.path,
          startLine: args.loc?.[0],
        });
      }

      case 'readFiles': {
        return this.readFiles({ ...args, cwd });
      }

      case 'writeFile': {
        return this.writeFile({ content: args.content, cwd, path: args.path });
      }

      case 'editFile': {
        return this.editFile({
          all: args.replace_all,
          cwd,
          path: args.file_path,
          replace: args.new_string,
          search: args.old_string,
        });
      }

      case 'moveFiles': {
        return this.moveFiles({
          cwd,
          operations:
            args.items?.map((item: { newPath: string; oldPath: string }) => ({
              destination: item.newPath,
              source: item.oldPath,
            })) ?? [],
        });
      }

      case 'renameFile': {
        return this.renameFile({ newName: args.newName, oldPath: args.path });
      }

      case 'runCommand': {
        // ComputerRuntime's RunCommandState reads `background` for `isBackground`;
        // the manifest exposes `run_in_background`. Keep the original field too —
        // the IPC handler reads `run_in_background` itself.
        return this.runCommand({
          ...args,
          background: args.run_in_background,
          command: args.command,
          cwd,
        });
      }

      case 'getCommandOutput': {
        return this.getCommandOutput({
          commandId: args.shell_id,
          filter: args.filter,
          timeout: args.timeout,
        });
      }

      case 'killCommand': {
        return this.killCommand({ commandId: args.shell_id });
      }

      case 'grepContent': {
        // Anchor the search root on the working directory and forward the FULL
        // param set (glob / output_mode / -i / -A / … ) — stripping flags here
        // silently defeated the agent's filters in the past. `cwd` is a legacy
        // search-root alias that takes precedence downstream — strip a
        // model-supplied one on the audited path (see trust boundary above).
        return this.grepContent({
          ...resolveArgsWithScope(args, 'path', workingDirectory),
          // `cwd` outranks the resolved `path` downstream, so the resolved root
          // must not be shadowed by an untrusted value; keep it only when the
          // caller vouched for it (gateway / CLI, post-sanitization).
          cwd: workingDirectory ? undefined : trustedArgsCwd,
          pattern: args.pattern,
        });
      }

      case 'globFiles': {
        // `cwd` is a legacy alias for `scope` — only honored when trusted (see
        // trust boundary above).
        return this.globFiles({
          directory: resolvePathWithScope(args.scope, cwd),
          limit: normalizeLimit(args.limit),
          pattern: args.pattern,
        });
      }

      case 'searchFiles': {
        const resolved = resolveArgsWithScope(args, 'directory', workingDirectory);
        return this.searchFiles({ ...resolved, limit: normalizeLimit(resolved.limit) });
      }

      default: {
        return null;
      }
    }
  }

  protected async callService(
    toolName: string,
    params: Record<string, any>,
  ): Promise<ServiceResult> {
    const methodName = SERVICE_METHOD_MAP[toolName];
    if (!methodName) {
      return { error: { message: `Unknown tool: ${toolName}` }, result: null, success: false };
    }

    // Map ComputerRuntime params back to IPC-expected shapes
    const ipcParams = this.denormalizeParams(toolName, params);

    const method = this.service[methodName] as (params: any) => Promise<any>;
    const result = await method(ipcParams);

    return this.normalizeResult(toolName, result);
  }

  /**
   * Map ComputerRuntime normalized params back to IPC field names.
   */
  private denormalizeParams(toolName: string, params: Record<string, any>): any {
    switch (toolName) {
      case 'editLocalFile': {
        return {
          cwd: params.cwd,
          file_path: params.path,
          new_string: params.replace,
          old_string: params.search,
          replace_all: params.all,
        };
      }

      case 'listLocalFiles': {
        return {
          cwd: params.cwd,
          limit: params.limit,
          path: params.directoryPath,
          sortBy: params.sortBy,
          sortOrder: params.sortOrder,
        };
      }

      case 'moveLocalFiles': {
        return {
          cwd: params.cwd,
          items: params.operations?.map((op: any) => ({
            newPath: op.destination,
            oldPath: op.source,
          })),
        };
      }

      case 'renameLocalFile': {
        return {
          newName: params.newName,
          path: params.oldPath,
        };
      }

      case 'getCommandOutput': {
        return { filter: params.filter, shell_id: params.commandId, timeout: params.timeout };
      }

      case 'killCommand': {
        return { shell_id: params.commandId };
      }

      case 'readLocalFile': {
        const loc: [number, number] | undefined =
          params.startLine !== undefined || params.endLine !== undefined
            ? [params.startLine ?? 0, params.endLine ?? 200]
            : undefined;
        return { cwd: params.cwd, fullContent: params.fullContent, loc, path: params.path };
      }

      case 'runCommand': {
        // Map the normalized `background` back to the IPC `run_in_background`
        // (kept when already present). `cwd` rides through via the spread —
        // without it the shell spawns in the service's own process cwd.
        return { ...params, run_in_background: params.run_in_background ?? params.background };
      }

      case 'globLocalFiles': {
        return {
          limit: params.limit,
          pattern: params.pattern,
          scope: params.directory,
        };
      }

      case 'grepContent': {
        // Forward the FULL param set. The desktop content-search reads
        // `path`/`scope`/`cwd` for the search root and
        // `glob`/`type`/`-i`/`-n`/`-A`/`-B`/`-C`/`multiline`/`head_limit`/`output_mode`
        // for filtering. Collapsing to a stripped `{cwd, filePattern, output_mode,
        // pattern}` shape here silently dropped every filter flag and renamed
        // `glob`→`filePattern` (a field the desktop `buildGrepArgs` never reads),
        // so case-insensitive / typed / glob-scoped searches returned wrong or
        // empty results — defeating the executor-level forwarding fix. Keep every
        // field; only normalize the legacy search-root alias so `cwd`-only callers
        // still work without shadowing an explicit `path`/`scope`.
        return {
          ...params,
          cwd: params.cwd ?? params.directory ?? params.path ?? params.scope,
        };
      }

      default: {
        return params;
      }
    }
  }

  /**
   * Batch read multiple files — unique to local system.
   */
  async readFiles(params: any): Promise<BuiltinServerRuntimeOutput> {
    try {
      const { formatMultipleFiles } = await import('@lobechat/prompts/fileSystem');
      const results = await this.service.readLocalFiles(params);

      return {
        content: formatMultipleFiles(results),
        state: { filesContent: results },
        success: true,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Normalize raw IPC results into the ServiceResult format.
   * IPC methods return domain objects directly; we wrap them appropriately.
   */
  private normalizeResult(toolName: string, raw: any): ServiceResult {
    switch (toolName) {
      case 'runCommand': {
        // RunCommandResult has snake_case fields from local-file-shell
        return {
          // Surface raw.error at the top level so ComputerRuntime.errorOutput
          // has a real message to render. Its priority chain reads the
          // ServiceResult's own `error`, then `state.stderr`, then
          // `state.error` — a runCommand that fails before spawning fills none
          // of those (there is no process, so no stderr), so every such failure
          // collapsed to the generic "[UNKNOWN_EXEC_ERROR] Tool execution
          // failed" with the reason discarded. That hid, among others, every
          // Local Sandbox refusal: "requires a working directory", "unavailable
          // on this device". Mirrors editLocalFile / grep / glob below.
          error: raw.error ? { message: String(raw.error) } : undefined,
          result: {
            error: raw.error,
            exitCode: raw.exit_code,
            output: raw.output,
            commandId: raw.shell_id,
            durationMs: raw.duration_ms,
            outputFiles: raw.output_files,
            // Carried through so the run itself can say whether it was fenced.
            // The picker's chip only shows the user's intent, and a run that
            // lost the flag somewhere in between looks identical otherwise.
            sandboxed: raw.sandboxed,
            stderr: raw.stderr,
            stdout: raw.stdout,
            success: raw.success,
          },
          success: raw.success,
        };
      }

      case 'getCommandOutput': {
        return {
          result: {
            durationMs: raw.duration_ms,
            exitCode: raw.exit_code,
            error: raw.error,
            outputFiles: raw.output_files,
            stderr: raw.stderr,
            stdout: raw.stdout,
            success: raw.success,
          },
          success: raw.success,
        };
      }

      case 'killCommand': {
        return {
          result: { error: raw.error, success: raw.success },
          success: raw.success,
        };
      }

      case 'grepContent': {
        return {
          // Surface raw.error so ComputerRuntime.errorOutput has a real message
          // to render instead of `JSON.stringify(undefined)` → undefined content.
          error: raw.error ? { message: String(raw.error) } : undefined,
          result: {
            matches: raw.matches,
            totalMatches: raw.total_matches,
          },
          success: raw.success,
        };
      }

      case 'globLocalFiles': {
        return {
          // Surface raw.error so ComputerRuntime.errorOutput has a real message
          // to render instead of `JSON.stringify(undefined)` → undefined content.
          // Without this, a fast-glob throw (e.g. EACCES traversing a protected
          // dir under the wrong cwd) leaves the tool message with state set but
          // content stuck at "" — see "Glob search files Response Empty" report.
          error: raw.error ? { message: String(raw.error) } : undefined,
          result: {
            files: raw.files,
            totalCount: raw.total_files,
          },
          success: raw.success,
        };
      }

      case 'listLocalFiles': {
        return {
          result: { files: raw.files, totalCount: raw.totalCount },
          success: true,
        };
      }

      case 'readLocalFile': {
        // Pass through all IPC fields for render compatibility
        return {
          result: {
            charCount: raw.charCount,
            content: raw.content,
            fileType: raw.fileType,
            filename: raw.filename,
            // Image results: set by LocalFileCtr when the path resolves to an
            // image (uploaded in main), so ComputerRuntime can route them to
            // `state.images`.
            imageFileId: raw.imageFileId,
            imageUrl: raw.imageUrl,
            isImage: raw.isImage,
            loc: raw.loc,
            totalCharCount: raw.totalCharCount,
            totalLineCount: raw.totalLineCount,
          },
          success: true,
        };
      }

      case 'writeLocalFile': {
        return {
          result: { bytesWritten: raw.bytesWritten, success: raw.success },
          success: raw.success ?? true,
        };
      }

      case 'editLocalFile': {
        return {
          // Surface raw.error at the top level so ComputerRuntime.errorOutput has
          // a real message to render. Without this, a failed edit (e.g. old_string
          // not found — common on Windows when CRLF/LF differ) left result.error
          // undefined and the tool message collapsed to the generic
          // "[UNKNOWN_EXEC_ERROR] Tool execution failed", hiding the real reason
          // and blocking the model from self-correcting. Mirrors grep/glob above.
          error: raw.error ? { message: String(raw.error) } : undefined,
          result: {
            diffText: raw.diffText,
            error: raw.error,
            linesAdded: raw.linesAdded,
            linesDeleted: raw.linesDeleted,
            replacements: raw.replacements,
          },
          success: raw.success,
        };
      }

      case 'searchLocalFiles': {
        // Returns LocalFileItem[] directly
        const results = Array.isArray(raw) ? raw : [];
        return {
          result: { results, totalCount: results.length },
          success: true,
        };
      }

      case 'moveLocalFiles': {
        // Returns LocalMoveFilesResultItem[] directly
        const results = Array.isArray(raw) ? raw : [];
        return {
          result: {
            results,
            successCount: results.filter((r: any) => r.success).length,
          },
          success: true,
        };
      }

      case 'renameLocalFile': {
        return {
          result: { error: raw.error, newPath: raw.newPath, success: raw.success },
          success: raw.success,
        };
      }

      default: {
        // Generic passthrough
        return { result: raw, success: true };
      }
    }
  }
}
