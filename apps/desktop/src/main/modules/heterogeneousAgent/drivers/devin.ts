import type { HeterogeneousAgentDriver } from '../types';

export const devinDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan() {
    throw new Error('Devin prompts must run through the native ACP session');
  },
};
