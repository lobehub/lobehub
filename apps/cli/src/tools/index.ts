import { log } from '../utils/logger';
import { checkPlatformCapability } from './checkPlatformCapability';
import { getAgentProfile } from './getAgentProfile';
import { cancelHeteroTask, runHeteroTask } from './heteroTask';
import { runLocalSystemTool } from './localSystemRuntime';

/**
 * CLI-only tools (platform agents). File/shell tools are handled separately by
 * {@link runLocalSystemTool}, which routes them through
 * `LocalSystemExecutionRuntime` so the result carries structured `state`.
 */
const methodMap: Record<string, (args: any) => Promise<unknown>> = {
  cancelHeteroTask,
  checkPlatformCapability,
  getAgentProfile,
  runHeteroTask,
};

export async function executeToolCall(
  apiName: string,
  argsStr: string,
  timeout?: number,
): Promise<{
  content: string;
  error?: string;
  state?: unknown;
  success: boolean;
}> {
  let args: Record<string, any>;
  try {
    args = JSON.parse(argsStr);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error(`Tool call failed: ${apiName} - ${errorMsg}`);
    return { content: '', error: errorMsg, success: false };
  }

  const finalArgs =
    typeof timeout === 'number' && Number.isFinite(timeout) && !('timeout' in args)
      ? { ...args, timeout }
      : args;

  try {
    // File/shell tools route through LocalSystemExecutionRuntime so `content` is
    // the formatted prompt text and `state` carries the structured payload for
    // client renders — matching the desktop gateway path (PR #15114).
    const localResult = await runLocalSystemTool(apiName, finalArgs);
    if (localResult) {
      const { error } = localResult;
      return {
        content: localResult.content,
        error:
          error instanceof Error ? error.message : typeof error === 'string' ? error : undefined,
        state: localResult.state,
        success: localResult.success,
      };
    }

    // CLI-only tools return raw domain payloads, serialized into `content`.
    const handler = methodMap[apiName];
    if (!handler) {
      return { content: '', error: `Unknown tool API: ${apiName}`, success: false };
    }

    const result = await handler(finalArgs);
    const content = typeof result === 'string' ? result : JSON.stringify(result);

    return { content, success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error(`Tool call failed: ${apiName} - ${errorMsg}`);
    return { content: '', error: errorMsg, success: false };
  }
}
