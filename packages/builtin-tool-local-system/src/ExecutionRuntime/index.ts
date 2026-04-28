import type { ServiceResult } from '@lobechat/tool-runtime';
import { ComputerRuntime } from '@lobechat/tool-runtime';
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

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
          file_path: params.path,
          new_string: params.replace,
          old_string: params.search,
          replace_all: params.all,
        };
      }

      case 'listLocalFiles': {
        return {
          path: params.directoryPath,
          sortBy: params.sortBy,
          sortOrder: params.sortOrder,
        };
      }

      case 'moveLocalFiles': {
        return {
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
        return { shell_id: params.commandId };
      }

      case 'killCommand': {
        return { shell_id: params.commandId };
      }

      case 'readLocalFile': {
        const loc: [number, number] | undefined =
          params.startLine !== undefined || params.endLine !== undefined
            ? [params.startLine ?? 0, params.endLine ?? 200]
            : undefined;
        return { fullContent: params.fullContent, loc, path: params.path };
      }

      case 'globLocalFiles': {
        return {
          pattern: params.pattern,
          scope: params.directory,
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
      const { formatMultipleFiles } = await import('@lobechat/prompts');
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
          result: {
            error: raw.error,
            exitCode: raw.exit_code,
            output: raw.output,
            commandId: raw.shell_id,
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
            error: raw.error,
            newOutput: raw.output,
            running: raw.running,
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
          result: {
            matches: raw.matches,
            totalMatches: raw.total_matches,
          },
          success: raw.success,
        };
      }

      case 'globLocalFiles': {
        return {
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
