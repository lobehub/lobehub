import type { Writable } from 'node:stream';

import { ClaudeCodeAdapter } from '@lobechat/heterogeneous-agents';
import type { AgentStreamEvent } from '@lobechat/heterogeneous-agents/spawn';
import { ClaudeCodeLiveInput } from '@lobechat/heterogeneous-agents/spawn';

/*
 * Claude Code spawned on this machine with its input kept open (Follow-up
 * behavior: Steer), so a message the user sends mid-run reaches the running
 * session instead of waiting for it to end. The driver adds
 * `--replay-user-messages`: the replay of a delivered message is how it is
 * known to be read.
 */

/**
 * Write the prompt to the CLI's stdin. With `live`, stdin stays open for as
 * long as the session can still use input (see `ClaudeCodeLiveInput`);
 * otherwise it is closed after the prompt, as a one-shot run does.
 */
export const writeCliPrompt = (
  stdin: Writable,
  payload: string,
  live: boolean,
): ClaudeCodeLiveInput | undefined => {
  if (!live) {
    stdin.write(payload, () => {
      stdin.end();
    });
    return;
  }

  const input = new ClaudeCodeLiveInput(stdin);
  input.send(payload);
  return input;
};

/**
 * A live session can run more turns after its first `result` (the one a steer
 * interrupts, and the one answering it), so the runtime ends once, at process
 * exit — the way the SDK transport and `lh hetero exec` report it.
 */
export const createLiveCliAdapter = () =>
  new ClaudeCodeAdapter({
    runtimeEndStrategy: 'on-transport-close',
    signalBackgroundTaskCompletion: true,
  });

/**
 * The runtime end a live session reports at process exit: complete, or
 * interrupted when its last turn was stopped. Only a clean exit after a
 * finished turn ends the run here; anything else is the exit path's to report.
 * Print mode exits 1 when its last turn was an interrupt.
 */
export const completeLiveCliRuntime = (
  pipeline: { completeRuntime: (data: Record<string, unknown>) => AgentStreamEvent[] },
  input: ClaudeCodeLiveInput | undefined,
  exit: { cancelledByUs: boolean; code: number | null; signal: NodeJS.Signals | null },
): AgentStreamEvent[] => {
  const lastTurn = input?.lastTurn;
  if (!lastTurn || exit.cancelledByUs) return [];

  const cleanExit =
    exit.code === 0 || (lastTurn.aborted && exit.code === 1 && exit.signal === null);
  if (!cleanExit) return [];

  const end = lastTurn.aborted
    ? { kind: 'aborted', reason: 'interrupted', terminalReason: lastTurn.terminalReason }
    : { reason: 'complete' };
  return pipeline.completeRuntime({ ...end, transport: 'cli-live' });
};
