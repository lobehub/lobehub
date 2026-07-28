export { decodeClixml } from './clixml';
export type { ShellProcess } from './process-manager';
export { ShellProcessManager } from './process-manager';
export type { RunCommandOptions } from './runner';
export { runCommand } from './runner';
export {
  buildOutputPreview,
  detectWindowsShell,
  findGitBash,
  getShellConfig,
  getShellInfo,
  getWindowsShellPreference,
  INLINE_OUTPUT_MAX_BYTES,
  normalizeEnvVarRefs,
  resetShellDetectionCache,
  setWindowsShellPreference,
  type ShellInfo,
  type WindowsShellPreference,
  type WindowsShellType,
} from './utils';
