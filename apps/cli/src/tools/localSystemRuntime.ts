import type {
  BaseFileSearch,
  GlobFilesParams,
  SearchFilesParams,
} from '@lobechat/local-file-shell';
import { createFileSearchModule } from '@lobechat/local-file-shell';
import { type ILocalSystemService, LocalSystemExecutionRuntime } from '@lobechat/tool-runtime';

import { editLocalFile, grepContent, listLocalFiles, readLocalFile, writeLocalFile } from './file';
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

const DEFAULT_FILE_SEARCH_LIMIT = 100;

const fileSearch: BaseFileSearch = createFileSearchModule();

const normalizeLimit = (limit?: number) =>
  Number.isFinite(limit) && limit && limit > 0 ? Math.floor(limit) : DEFAULT_FILE_SEARCH_LIMIT;

const globLocalFiles = async (params: GlobFilesParams) =>
  fileSearch.glob({ ...params, limit: normalizeLimit(params.limit) });

const searchLocalFiles = async (params: SearchFilesParams) =>
  fileSearch.search({ ...params, limit: normalizeLimit(params.limit) });

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
 * Route file/shell tool calls through `LocalSystemExecutionRuntime` so the
 * result carries structured `state` (for client renders) and `content` is the
 * formatted prompt text — matching the desktop gateway path (PR #15114).
 *
 * The runtime's `executeToolCall` owns legacy alias normalization, IPC field
 * mapping, and cwd/scope forwarding — the server runtime injects the
 * device-bound `cwd`/`scope` into `args` before dispatch, and they now ride
 * through to the local-file-shell functions instead of being dropped.
 *
 * Returns `null` when `apiName` is not a local-system tool, so the caller can
 * fall back to CLI-only tools (platform agents).
 */
export async function runLocalSystemTool(
  apiName: string,
  args: Record<string, any>,
): Promise<LocalSystemToolOutput | null> {
  // `trustArgsCwd` — args reach the CLI only after the server runtime has
  // stripped any inbound `cwd` and re-injected the device-bound one, so the
  // `cwd` in `args` here is server-controlled rather than model-chosen.
  return runtime.executeToolCall(apiName, args, { trustArgsCwd: true });
}
