import type { BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { AuvApiName, AuvIdentifier, type AuvRunCommandParams } from '../../types';

class AuvExecutor extends BaseExecutor<typeof AuvApiName> {
  readonly identifier = AuvIdentifier;
  protected readonly apiEnum = AuvApiName;

  /**
   * Triggering workflow: {@link BaseExecutor.invoke} -> `runCommand`
   * -> Electron `auv.runCommand`; preserve CLI failures in the tool result.
   */
  runCommand = async (params: AuvRunCommandParams): Promise<BuiltinToolResult> => {
    try {
      const { electronAuvService } = await import('@/services/electron/auv');
      const result = await electronAuvService.runCommand(params);
      return {
        content: JSON.stringify(result),
        ...(result.exitCode !== 0 && {
          error: {
            body: result.output,
            message: result.stderr || `Computer Use exited with code ${result.exitCode}`,
            type: 'PluginServerError',
          },
        }),
        state: result,
        success: result.exitCode === 0,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: message,
        error: { body: error, message, type: 'PluginServerError' },
        success: false,
      };
    }
  };
}

export const auvExecutor = new AuvExecutor();
