import type { BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { AuvApiName, AuvIdentifier, type AuvRunCommandParams } from '../../types';

const AuvApiEnum = AuvApiName;

class AuvExecutor extends BaseExecutor<typeof AuvApiEnum> {
  readonly identifier = AuvIdentifier;
  protected readonly apiEnum = AuvApiEnum;

  runCommand = async (params: AuvRunCommandParams): Promise<BuiltinToolResult> => {
    try {
      const { electronAuvService } = await import('@/services/electron/auv');
      const result = await electronAuvService.runCommand(params);
      return { content: JSON.stringify(result), state: result, success: true };
    } catch (error) {
      return this.errorResult(error);
    }
  };

  private errorResult(error: unknown): BuiltinToolResult {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: message,
      error: { body: error, message, type: 'PluginServerError' },
      success: false,
    };
  }
}

export const auvExecutor = new AuvExecutor();
