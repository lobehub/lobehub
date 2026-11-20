import type { HeterogeneousAgentDriver } from '../types';

export const copilotDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan() {
    throw new Error('GitHub Copilot prompts must run through the native ACP session');
  },
};
