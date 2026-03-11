import {
  type GetCommandOutputParams,
  type KillCommandParams,
  runCommand as runCommandCore,
  type RunCommandParams,
  ShellProcessManager,
} from '@lobechat/local-file-shell';

import { log } from '../utils/logger';

const processManager = new ShellProcessManager();

export function cleanupAllProcesses() {
  processManager.cleanupAll();
}

export async function runCommand(params: RunCommandParams) {
  return runCommandCore(params, { logger: log, processManager });
}

export async function getCommandOutput(params: GetCommandOutputParams) {
  return processManager.getOutput(params);
}

export async function killCommand(params: KillCommandParams) {
  return processManager.kill(params.shell_id);
}
