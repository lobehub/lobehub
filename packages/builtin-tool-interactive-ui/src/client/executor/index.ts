import { BaseExecutor, type BuiltinToolResult } from '@lobechat/types';

import { InteractiveUIExecutionRuntime } from '../../ExecutionRuntime';
import { InteractiveUIApiName, InteractiveUIIdentifier } from '../../types';

class InteractiveUIExecutor extends BaseExecutor<typeof InteractiveUIApiName> {
  readonly identifier = InteractiveUIIdentifier;
  protected readonly apiEnum = InteractiveUIApiName;
  private readonly runtime = new InteractiveUIExecutionRuntime();

  renderUI = async (args: unknown): Promise<BuiltinToolResult> => {
    return this.runtime.renderUI(args);
  };
}

export const interactiveUIExecutor = new InteractiveUIExecutor();
