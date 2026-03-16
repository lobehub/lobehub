import { log } from '../utils/logger';
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

const methodMap: Record<string, (args: any) => Promise<unknown>> = {
  editLocalFile,
  getCommandOutput,
  globLocalFiles,
  grepContent,
  killCommand,
  listLocalFiles,
  readLocalFile,
  runCommand,
  searchLocalFiles,
  writeLocalFile,
};

export async function executeToolCall(
  apiName: string,
  argsStr: string,
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

    const result = await handler(args);
    const content = typeof result === 'string' ? result : JSON.stringify(result);

    return { content, success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error(`Tool call failed: ${apiName} - ${errorMsg}`);
    return { content: '', error: errorMsg, success: false };
  }
}
