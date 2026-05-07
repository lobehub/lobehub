/**
 * API names for Cloud Sandbox tool
 */
export const CloudSandboxApiName = {
  editFile: 'editFile',
  executeCode: 'executeCode',
  exportFile: 'exportFile',
  getCommandOutput: 'getCommandOutput',
  globFiles: 'globFiles',
  grepContent: 'grepContent',
  killCommand: 'killCommand',
  listFiles: 'listFiles',
  moveFiles: 'moveFiles',
  readFile: 'readFile',
  runCommand: 'runCommand',
  searchFiles: 'searchFiles',
  writeFile: 'writeFile',
} as const;

export type CloudSandboxApiNameType =
  (typeof CloudSandboxApiName)[keyof typeof CloudSandboxApiName];
