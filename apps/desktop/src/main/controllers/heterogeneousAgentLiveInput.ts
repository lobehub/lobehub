import type { Writable } from 'node:stream';

import { ClaudeCodeAdapter } from '@lobechat/heterogeneous-agents';
import type { AgentStreamEvent } from '@lobechat/heterogeneous-agents/spawn';
import {
  ClaudeCodeLiveInput,
  resolveClaudeCodeLiveRuntimeEnd,
} from '@lobechat/heterogeneous-agents/spawn';

/*
 * Claude Code spawned on this machine keeps its input open, like under
 * `lh hetero exec`, whatever the Follow-up mode: it carries control requests
 * (stop one background task) and, in Steer mode, the messages the user sends
 * mid-run. The driver adds `--replay-user-messages`: the replay of a delivered
 * message is how it is known to be read. The run ends at process exit, by the
 * rule shared with `lh` (`resolveClaudeCodeLiveRuntimeEnd`).
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
 * A live session can run more turns after its first `result` (the one a
 * background task's completion wakes, the one answering a steer), so the
 * runtime ends once, at process exit — the way the SDK transport and
 * `lh hetero exec` report it.
 */
export const createLiveCliAdapter = () =>
  new ClaudeCodeAdapter({
    runtimeEndStrategy: 'on-transport-close',
    signalBackgroundTaskCompletion: true,
  });

/**
 * The runtime end a live session reports at a process exit the host did not
 * cause, by the rule `lh hetero exec` uses (`resolveClaudeCodeLiveRuntimeEnd`):
 * complete, or interrupted when its last turn was stopped — print mode exits 1
 * then, and the run still ends cleanly. Empty when the run does not end here
 * (a crash, an error the run already reported, no finished turn).
 */
export const endLiveCliRun = (
  pipeline: { completeRuntime: (data: Record<string, unknown>) => AgentStreamEvent[] },
  input: ClaudeCodeLiveInput | undefined,
  exit: { code: number | null; sawError: boolean; signal: NodeJS.Signals | null },
): AgentStreamEvent[] => {
  const end = resolveClaudeCodeLiveRuntimeEnd(input?.lastTurn, { ...exit, killedByHost: false });
  return end ? pipeline.completeRuntime(end) : [];
};
