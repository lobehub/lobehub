import type { HeterogeneousAgentDriver } from '../types';

export const antigravityDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan() {
    throw new Error('Antigravity prompts must run through the native ACP session');
  },
};
