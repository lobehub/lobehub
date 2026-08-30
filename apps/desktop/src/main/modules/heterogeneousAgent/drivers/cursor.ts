import type { HeterogeneousAgentDriver } from '../types';

/** Cursor prompts are owned by CursorAcpSession in the controller, never by one-shot spawn. */
export const cursorDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan() {
    throw new Error('Cursor prompts must run through the native ACP session');
  },
};
