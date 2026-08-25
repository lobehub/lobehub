import type { ChaosAdapter } from '@achaos/core';

export interface ProcessChaosAdapterOptions {
  allowedPids: ReadonlySet<number>;
}

const TERMINATING_SIGNALS = new Set<NodeJS.Signals>(['SIGINT', 'SIGKILL', 'SIGTERM']);

/** Destructive adapter with explicit PID ownership; it refuses arbitrary process targets. */
export const createProcessChaosAdapter = ({
  allowedPids,
}: ProcessChaosAdapterOptions): ChaosAdapter => ({
  inject: async (context) => {
    const pid = context.experiment.target.selector.pid;
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0)
      throw new Error('Process target requires a positive integer pid');
    if (!allowedPids.has(pid)) throw new Error(`PID ${pid} is not owned by this chaos run`);
    if (!context.experiment.safety.destructive)
      throw new Error('kill_process requires safety.destructive=true');
    const effect = context.experiment.effect;
    if (effect.type !== 'kill_process')
      throw new Error('Process adapter only supports kill_process');
    const signal = effect.signal ?? 'SIGKILL';
    if (!TERMINATING_SIGNALS.has(signal))
      throw new Error(`Process adapter does not permit non-terminating signal ${signal}`);
    process.kill(pid, signal);
    return {
      adapter: 'process',
      details: { pid, signal },
      injectionId: `${context.runId}:process`,
    };
  },
  name: 'process',
});
