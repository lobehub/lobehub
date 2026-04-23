import { ProcessRegistry } from '@lobechat/process-registry';

/**
 * Single, main-process-wide registry that tracks every child spawned through
 * `@lobechat/process-registry`. Consumed by both ShellCommandCtr (as the
 * tree-kill backend for its ShellProcessManager) and ProcessManagerCtr (to
 * answer list/kill/subscribe IPC from the renderer).
 */
export const processRegistry = new ProcessRegistry();
