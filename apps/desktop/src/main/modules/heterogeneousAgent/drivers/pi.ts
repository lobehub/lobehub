import type { HeterogeneousAgentBuildPlanParams, HeterogeneousAgentDriver } from '../types';

/**
 * Pi runs exclusively over the RPC transport (`pi --mode rpc` via
 * `PiRpcSession` / `createPiRpcAgentHandle`) — the legacy one-shot
 * `--mode json` spawn is gone and there is no fallback. The driver stays
 * registered so `startSession` validation keeps accepting `pi`, but any code
 * that still reaches the generic CLI spawn plan for pi is a bug and must fail
 * loudly instead of silently running the interactive CLI.
 */
export const piDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan(_params: HeterogeneousAgentBuildPlanParams) {
    throw new Error(
      'pi runs over the RPC transport only — use PiRpcSession / createPiRpcAgentHandle, not the CLI spawn path',
    );
  },
};
