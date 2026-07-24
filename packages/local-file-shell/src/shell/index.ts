export type { ShellProcess } from './process-manager';
export { ShellProcessManager } from './process-manager';
export type { RunCommandOptions } from './runner';
export { runCommand } from './runner';
export {
  buildOutputPreview,
  detectWindowsShell,
  expandEnvVars,
  getShellConfig,
  getShellInfo,
  INLINE_OUTPUT_MAX_BYTES,
  resetShellDetectionCache,
  type ShellInfo,
  type WindowsShellType,
} from './utils';
