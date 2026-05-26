import { log } from '../utils/logger';
import { checkPlatformCapability } from './checkPlatformCapability';
import {
  editLocalFile,
  globLocalFiles,
  grepContent,
  listLocalFiles,
  readLocalFile,
  searchLocalFiles,
  writeLocalFile,
} from './file';
import { getAgentProfile } from './getAgentProfile';
import { cancelHeteroTask, runHeteroTask } from './heteroTask';
import { getCommandOutput, killCommand, runCommand } from './shell';

const methodMap: Record<string, (args: any) => Promise<unknown>> = {
  cancelHeteroTask,
  checkPlatformCapability,
  getAgentProfile,
  editFile: editLocalFile,
  getCommandOutput,
  globFiles: globLocalFiles,
  grepContent,
  killCommand,
  listFiles: listLocalFiles,
  readFile: readLocalFile,
  runCommand,
  runHeteroTask,
  searchFiles: searchLocalFiles,
  writeFile: writeLocalFile,

  // Legacy aliases — older Gateway versions may still send the long form
  editLocalFile,
  globLocalFiles,
  listLocalFiles,
  readLocalFile,
  searchLocalFiles,
  writeLocalFile,
};

export async function executeToolCall(
  apiName: string,
  argsStr: string,
  timeout?: number,
): Promise<{
  content: string;
  error?: string;
  success: boolean;
}> {
  const handler = methodMap[apiName];
  if (!handler) {
    return { content: '', error: `Unknown tool API: ${apiName}`, success: false };
  }

  try {
    const args = JSON.parse(argsStr);
    const finalArgs =
      typeof timeout === 'number' && Number.isFinite(timeout) && !('timeout' in args)
        ? { ...args, timeout }
        : args;

    const result = await handler(finalArgs);
    const content = typeof result === 'string' ? result : JSON.stringify(result);

    return { content, success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error(`Tool call failed: ${apiName} - ${errorMsg}`);
    return { content: '', error: errorMsg, success: false };
  }
}
