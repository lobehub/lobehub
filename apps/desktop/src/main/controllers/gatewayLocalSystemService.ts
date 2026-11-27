import type { ILocalSystemService } from '@lobechat/tool-runtime';

import type LocalFileCtr from './LocalFileCtr';
import type ShellCommandCtr from './ShellCommandCtr';

/**
 * The `LocalSystemExecutionRuntime` service behind gateway tool calls: a thin
 * adapter over the desktop's file and shell controllers, plus the agent file
 * scan the server asks for on file tools (`@lobechat/device-control`, loaded
 * on first use like the device RPC dispatcher).
 */
export const createGatewayLocalSystemService = (
  local: LocalFileCtr,
  shell: ShellCommandCtr,
): ILocalSystemService => ({
  discoverAgentFiles: async (params) =>
    (await import('@lobechat/device-control')).discoverAgentFiles(params),
  editLocalFile: (p) => local.handleEditFile(p),
  getCommandOutput: (p) => shell.handleGetCommandOutput(p),
  globFiles: (p) => local.handleGlobFiles(p),
  grepContent: (p) => local.handleGrepContent(p),
  killCommand: (p) => shell.handleKillCommand(p),
  listLocalFiles: (p) => local.listLocalFiles(p),
  moveLocalFiles: (p) => local.handleMoveFiles(p),
  readLocalFile: (p) => local.readFile(p),
  readLocalFiles: (p) => local.readFiles(p),
  renameLocalFile: (p) => local.handleRenameFile(p),
  runCommand: (p) => shell.handleRunCommand(p),
  searchLocalFiles: (p) => local.handleLocalFilesSearch(p),
  writeFile: (p) => local.handleWriteFile(p),
});
