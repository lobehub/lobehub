import { lobehubRouterRuntimeOptions } from '@lobechat/business-model-runtime';

import { createRouterRuntime } from '../../core/RouterRuntime';
import { CreateRouterRuntimeOptions } from '../../core/RouterRuntime/createRuntime';

export const LobeHubAI = createRouterRuntime(
  lobehubRouterRuntimeOptions as CreateRouterRuntimeOptions,
);
