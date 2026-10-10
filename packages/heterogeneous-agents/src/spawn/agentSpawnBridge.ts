import { PassThrough } from 'node:stream';

import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';

import type { SpawnAgentHandle } from './spawnAgent';

/**
 * Bridge a bidirectional agent session onto the ordinary `SpawnAgentHandle`
 * contract shared by the one-shot CLI spawns.
 *
 * Use when:
 * - Adapting ACP or Codex native sessions to the CLI event loop.
 *
 * Expects:
 * - One session whose events end when run() settles.
 *
 * Returns:
 * - Buffered events, stderr, and process-compatible exit/cancellation.
 *
 * Call stack:
 * spawnAgent / createCodexAgentHandle
 *   -> {@link createAgentSpawnBridge}
 *     -> session.run()
 *
 * Exit/error policy (originally shared by ACP agents):
 * - Host kills resolve `exit` as `{ code: null, signal }`.
 * - ACP request failures are first adapted into a terminal error event and
 *   then reject the session's run() promise. Once that structured event is
 *   queued, the iterable ends normally so callers can apply their error
 *   policy; transport failures with no terminal event still throw from the
 *   iterator.
 */
export const createAgentSpawnBridge = () => {
  const stderr = new PassThrough();
  const queue: AgentStreamEvent[] = [];
  let emittedTerminalError = false;
  let hostSignal: NodeJS.Signals | null = null;
  let streamEnded = false;
  let streamError: Error | undefined;
  let wakeup: (() => void) | undefined;

  const wake = () => {
    const resolve = wakeup;
    wakeup = undefined;
    resolve?.();
  };
  const getHostExit = (): { code: null; signal: NodeJS.Signals } | undefined =>
    hostSignal ? { code: null, signal: hostSignal } : undefined;

  const onEvents = (events: AgentStreamEvent[]): void => {
    if (events.some(({ type }) => type === 'error')) emittedTerminalError = true;
    queue.push(...events);
    wake();
  };
  const onStderr = (data: string): void => {
    stderr.write(data);
  };

  const events: AsyncIterable<AgentStreamEvent> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<AgentStreamEvent>> {
          while (true) {
            const event = queue.shift();
            if (event) return { done: false, value: event };
            if (streamError) throw streamError;
            if (streamEnded) return { done: true, value: undefined };
            await new Promise<void>((resolve) => {
              wakeup = resolve;
            });
          }
        },
      };
    },
  };

  const attach = (session: {
    close: (signal?: NodeJS.Signals | null) => void;
    /** Optional host teardown; failure remains fatal even after a requested Stop. */
    dispose?: () => Promise<void>;
    interrupt: () => void;
    run: () => Promise<void>;
  }): Pick<SpawnAgentHandle, 'exit' | 'interrupt' | 'kill'> => {
    const exit: SpawnAgentHandle['exit'] = session
      .run()
      .then(() => getHostExit() ?? { code: 0, signal: null })
      .catch((error) => {
        const hostExit = getHostExit();
        if (hostExit) return hostExit;

        if (!emittedTerminalError) {
          streamError = error instanceof Error ? error : new Error(String(error));
        }
        return { code: 1, signal: null };
      })
      .finally(async () => {
        try {
          await session.dispose?.();
        } catch (error) {
          // A requested signal explains an interrupted turn, never failed containment.
          streamError = error instanceof Error ? error : new Error(String(error));
          throw streamError;
        } finally {
          streamEnded = true;
          stderr.end();
          wake();
        }
      });

    const kill = (signal: NodeJS.Signals = 'SIGINT'): void => {
      hostSignal = signal;
      if (signal === 'SIGINT') session.interrupt();
      else session.close(signal);
    };
    const interrupt = (signal: NodeJS.Signals = 'SIGINT'): void => {
      hostSignal = signal;
      // SIGTERM already reached the child through the inherited process group.
      // Close pending RPCs without interrupting the child's shutdown again.
      if (signal === 'SIGTERM') session.close(null);
      else kill(signal);
    };
    return { exit, interrupt, kill };
  };

  return { attach, events, onEvents, onStderr, stderr };
};
