import type { Writable } from 'node:stream';

import { ClaudeCodeAdapter } from '@lobechat/heterogeneous-agents';
import type { AgentStreamEvent } from '@lobechat/heterogeneous-agents/spawn';
import {
  ClaudeCodeLiveInput,
  resolveClaudeCodeLiveRuntimeEnd,
} from '@lobechat/heterogeneous-agents/spawn';

export type LiveCliInput = ClaudeCodeLiveInput;

/*
 * Claude Code spawned on this machine keeps its stdin open, like under
 * `lh hetero exec`, so follow-up messages can be steered into the live
 * session. The run ends once at process exit, by the rule shared with `lh`.
 */

/**
 * Write the prompt to the CLI's stdin. With `live`, stdin stays open for as
 * long as the session can still use input (`ClaudeCodeLiveInput`); otherwise
 * it is closed after the prompt.
 */
export const writeCliPrompt = (
  stdin: Writable,
  payload: string,
  live: boolean,
): LiveCliInput | undefined => {
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
 * A live session can run more turns after its first `result` (the one a
 * background task's completion wakes, or the one answering a steer), so the
 * runtime ends once, at process exit.
 */
export const createLiveCliAdapter = () =>
  new ClaudeCodeAdapter({
    runtimeEndStrategy: 'on-transport-close',
    signalBackgroundTaskCompletion: true,
  });

/**
 * The runtime end a live session reports at a process exit the host did not
 * cause, by the rule `lh hetero exec` uses. Empty when the run does not end
 * here (a crash, an error the run already reported, no finished turn).
 */
export const endLiveCliRun = (
  pipeline: { completeRuntime: (data: Record<string, unknown>) => AgentStreamEvent[] },
  input: LiveCliInput | undefined,
  exit: { code: number | null; sawError: boolean; signal: NodeJS.Signals | null },
): AgentStreamEvent[] => {
  const end = resolveClaudeCodeLiveRuntimeEnd(input?.lastTurn, { ...exit, killedByHost: false });
  return end ? pipeline.completeRuntime(end) : [];
};
