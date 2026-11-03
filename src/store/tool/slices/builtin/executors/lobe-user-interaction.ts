import { UserInteractionExecutionRuntime } from '@lobechat/builtin-tool-user-interaction/executionRuntime';
import { UserInteractionExecutor } from '@lobechat/builtin-tool-user-interaction/executor';

const runtime = new UserInteractionExecutionRuntime();

export const userInteractionExecutor = new UserInteractionExecutor(runtime);
