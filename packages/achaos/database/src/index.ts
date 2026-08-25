import type { ChaosAdapter, ChaosJsonValue, ChaosRunContext } from '@achaos/core';

export interface DatabaseMutationReceipt {
  details?: Record<string, ChaosJsonValue>;
  snapshot?: Record<string, unknown>;
}

export interface DatabaseChaosPort {
  cancel?: (context: ChaosRunContext) => Promise<void>;
  mutate: (context: ChaosRunContext) => Promise<DatabaseMutationReceipt>;
  restore?: (snapshot: Record<string, unknown>, context: ChaosRunContext) => Promise<void>;
}

/** Database adapter owns no schema; applications supply scoped mutate/restore ports. */
export const createDatabaseChaosAdapter = (port: DatabaseChaosPort): ChaosAdapter => ({
  cancelInjection: port.cancel ? async (context) => port.cancel!(context) : undefined,
  cleanup: port.restore
    ? async (receipt, context) => {
        if (!receipt.cleanupToken) throw new Error('Database cleanup requires a mutation snapshot');
        await port.restore!(receipt.cleanupToken, context);
      }
    : undefined,
  inject: async (context) => {
    const result = await port.mutate(context);
    return {
      adapter: 'database',
      cleanupToken: result.snapshot,
      details: result.details,
      injectionId: `${context.runId}:database`,
    };
  },
  name: 'database',
});
