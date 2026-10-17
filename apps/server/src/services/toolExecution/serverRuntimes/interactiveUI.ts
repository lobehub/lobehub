import { InteractiveUIIdentifier } from '@lobechat/builtin-tool-interactive-ui';
import { InteractiveUIExecutionRuntime } from '@lobechat/builtin-tool-interactive-ui/executionRuntime';

import type { ServerRuntimeRegistration } from './types';

const runtime = new InteractiveUIExecutionRuntime();

export const interactiveUIRuntime: ServerRuntimeRegistration = {
  factory: () => runtime,
  identifier: InteractiveUIIdentifier,
};
