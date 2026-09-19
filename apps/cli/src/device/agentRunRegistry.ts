import type { ChildProcess } from 'node:child_process';

interface AgentRun {
  cancellation?: Promise<{ exited: boolean; pid?: number; signal: NodeJS.Signals }>;
  child: ChildProcess;
  exit: Promise<void>;
  exited?: boolean;
}

const runs = new Map<string, AgentRun>();

/** Gateway-dispatched wrappers must be reachable by the same operation's stop request. */
export function registerAgentRun(operationId: string, child: ChildProcess) {
  const run: AgentRun = {
    child,
    exit: new Promise<void>((resolve) => {
      child.once('close', () => {
        run.exited = true;
        // A stop can finish just after the gateway timeout. Keep the observed
        // exit briefly so the retry can confirm it instead of losing identity.
        setTimeout(() => {
          if (runs.get(operationId) === run) runs.delete(operationId);
        }, 300_000).unref();
        resolve();
      });
    }),
  };
  runs.set(operationId, run);
}

export function cancelAgentRun(operationId: string, signal: NodeJS.Signals = 'SIGINT') {
  const run = runs.get(operationId);
  if (!run) return;
  if (run.exited) return Promise.resolve({ exited: true, pid: run.child.pid, signal });
  if (run.cancellation) return run.cancellation;

  run.cancellation = (async () => {
    const waitForExit = async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), 2000);
      });
      const exited = await Promise.race([run.exit.then(() => true), timeout]);
      clearTimeout(timer);
      return exited;
    };
    // The wrapper forwards signals to its native child process group and drains
    // terminal callbacks before closing. Repeated SIGINT escalates that child;
    // killing only the wrapper could leave the writer alive.
    run.child.kill(signal === 'SIGKILL' ? 'SIGINT' : signal);
    let exited = await waitForExit();
    if (!exited) {
      run.child.kill('SIGINT');
      exited = await waitForExit();
    }
    if (!exited && signal === 'SIGTERM') {
      run.child.kill('SIGINT');
      exited = await waitForExit();
    }
    return { exited, pid: run.child.pid, signal };
  })().finally(() => {
    run.cancellation = undefined;
  });
  return run.cancellation;
}
