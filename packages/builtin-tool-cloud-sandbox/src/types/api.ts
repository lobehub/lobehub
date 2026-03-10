/**
 * API names for Cloud Sandbox tool
 */
export const CloudSandboxApiName = {
  editLocalFile: 'editLocalFile',
  executeCode: 'executeCode',
  exportFile: 'exportFile',
  getCommandOutput: 'getCommandOutput',
  globLocalFiles: 'globLocalFiles',
  grepContent: 'grepContent',
  killCommand: 'killCommand',
  listLocalFiles: 'listLocalFiles',
  moveLocalFiles: 'moveLocalFiles',
  readLocalFile: 'readLocalFile',
  renameLocalFile: 'renameLocalFile',
  runCommand: 'runCommand',
  searchLocalFiles: 'searchLocalFiles',
  writeLocalFile: 'writeLocalFile',
} as const;

export type CloudSandboxApiNameType =
  (typeof CloudSandboxApiName)[keyof typeof CloudSandboxApiName];
