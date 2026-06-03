import path from 'node:path';

import type {
  EditFileParams,
  GetCommandOutputParams,
  GlobFilesParams,
  GrepContentParams,
  KillCommandParams,
  ListFilesParams,
  ReadFileParams,
  RunCommandParams,
  SearchFilesParams,
  WriteFileParams,
} from '@lobechat/local-file-shell';
import { type ILocalSystemService, LocalSystemExecutionRuntime } from '@lobechat/tool-runtime';

import {
  editLocalFile,
  globLocalFiles,
  grepContent,
  listLocalFiles,
  readLocalFile,
  searchLocalFiles,
  writeLocalFile,
} from './file';
import { getCommandOutput, killCommand, runCommand } from './shell';

/**
 * Output envelope produced by {@link runLocalSystemTool}. Mirrors
 * `@lobechat/types`' `BuiltinServerRuntimeOutput`: `content` is the formatted
 * prompt text fed to the LLM, while `state` carries the structured payload that
 * client renders consume as `pluginState`.
 */
export interface LocalSystemToolOutput {
  content: string;
  error?: unknown;
  state?: unknown;
  success: boolean;
}

/**
 * Stub for `ILocalSystemService` methods the CLI does not expose (batch read,
 * move, rename). These are never routed by {@link runLocalSystemTool}; the
 * interface just requires them, so we fail loudly if one is ever reached.
 */
const unsupported = (method: string) => (): Promise<never> =>
  Promise.reject(new Error(`${method} is not supported by the LobeHub CLI`));

/**
 * Adapter wiring the CLI's `@lobechat/local-file-shell` functions (file ops) and
 * shell wrappers (with the shared `ShellProcessManager`) into the shape the
 * runtime expects. The runtime denormalizes its camelCase params back to the
 * snake_case IPC shapes these functions consume — see `LocalSystemExecutionRuntime`.
 */
const localSystemService: ILocalSystemService = {
  editLocalFile,
  getCommandOutput,
  globFiles: globLocalFiles,
  grepContent,
  killCommand,
  listLocalFiles,
  moveLocalFiles: unsupported('moveLocalFiles'),
  readLocalFile,
  readLocalFiles: unsupported('readLocalFiles'),
  renameLocalFile: unsupported('renameLocalFile'),
  runCommand,
  searchLocalFiles,
  writeFile: writeLocalFile,
};

const runtime = new LocalSystemExecutionRuntime(localSystemService);

/**
 * Legacy API name aliases used by older gateway versions. Normalized to the
 * current tool names before dispatch.
 */
const LEGACY_API_ALIASES: Record<string, string> = {
  editLocalFile: 'editFile',
  globLocalFiles: 'globFiles',
  listLocalFiles: 'listFiles',
  readLocalFile: 'readFile',
  searchLocalFiles: 'searchFiles',
  writeLocalFile: 'writeFile',
};

/**
 * Resolve a relative path against a scope (CWD). Mirrors the desktop gateway's
 * inline copy of the renderer-side `resolveArgsWithScope` helper so the CLI and
 * desktop produce identical scoping for search/grep tools.
 */
const resolveArgsWithScope = <T extends { scope?: string }>(args: T, pathField: string): T => {
  const scope = args.scope;
  const bag = args as Record<PropertyKey, unknown>;
  const currentPath = typeof bag[pathField] === 'string' ? (bag[pathField] as string) : undefined;
  if (!scope) return args;
  if (!currentPath) return { ...args, [pathField]: scope };
  if (path.isAbsolute(currentPath)) return args;
  return { ...args, [pathField]: path.join(scope, currentPath) };
};

/**
 * Route file/shell tool calls through `LocalSystemExecutionRuntime` so the
 * result carries structured `state` (for client renders) and `content` is the
 * formatted prompt text — matching the desktop gateway path (PR #15114).
 *
 * Returns `null` when `apiName` is not a local-system tool, so the caller can
 * fall back to CLI-only tools (platform agents).
 */
export async function runLocalSystemTool(
  apiName: string,
  args: Record<string, any>,
): Promise<LocalSystemToolOutput | null> {
  const normalized = LEGACY_API_ALIASES[apiName] ?? apiName;

  switch (normalized) {
    case 'listFiles': {
      const p = args as ListFilesParams;
      return runtime.listFiles({
        directoryPath: p.path,
        limit: p.limit,
        sortBy: p.sortBy,
        sortOrder: p.sortOrder,
      } as never);
    }

    case 'readFile': {
      const p = args as ReadFileParams;
      return runtime.readFile({
        endLine: p.loc?.[1],
        path: p.path,
        startLine: p.loc?.[0],
      });
    }

    case 'writeFile': {
      return runtime.writeFile(args as WriteFileParams);
    }

    case 'editFile': {
      const p = args as EditFileParams;
      return runtime.editFile({
        all: p.replace_all,
        path: p.file_path,
        replace: p.new_string,
        search: p.old_string,
      });
    }

    case 'searchFiles': {
      const resolved = resolveArgsWithScope(
        args as SearchFilesParams & { scope?: string },
        'directory',
      );
      return runtime.searchFiles({ ...resolved, directory: resolved.directory || '' } as never);
    }

    case 'grepContent': {
      const resolved = resolveArgsWithScope(args as GrepContentParams, 'path');
      return runtime.grepContent(resolved as never);
    }

    case 'globFiles': {
      const p = args as GlobFilesParams;
      // Honor both `scope` (current manifest) and the `cwd` legacy alias.
      return runtime.globFiles({ directory: p.scope ?? p.cwd, pattern: p.pattern });
    }

    case 'runCommand': {
      // ComputerRuntime's RunCommandState reads `args.background`; the manifest
      // exposes `run_in_background`. Without this normalize the state would
      // always show foreground even for background commands.
      const p = args as RunCommandParams;
      return runtime.runCommand({ ...p, background: p.run_in_background } as never);
    }

    case 'getCommandOutput': {
      // Forward `timeout` (gateway per-call budget, injected into args by
      // executeToolCall) so polling a running command honors it instead of the
      // service's default wait. The runtime carries it through to getOutput.
      const p = args as GetCommandOutputParams;
      return runtime.getCommandOutput({
        commandId: p.shell_id,
        filter: p.filter,
        timeout: p.timeout,
      } as never);
    }

    case 'killCommand': {
      const p = args as KillCommandParams;
      return runtime.killCommand({ commandId: p.shell_id });
    }

    default: {
      return null;
    }
  }
}
