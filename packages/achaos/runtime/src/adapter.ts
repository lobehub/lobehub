import type { ChaosAdapter } from '@achaos/core';

import type { RuntimeChaosController } from './controller';

export const createRuntimeChaosAdapter = (controller: RuntimeChaosController): ChaosAdapter => ({
  cancelInjection: async (context) => controller.cancelRun(context.runId),
  cleanup: async (receipt) => controller.disarm(receipt),
  inject: async (context) => controller.arm(context),
  name: 'runtime',
  verifyInjection: async (receipt) => controller.wasActivated(receipt),
});
