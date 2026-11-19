import type {
  ClaudeCodeControlRequest,
  ClaudeCodeControlRequestHandle,
} from './claudeCodeLiveInput';

/** How long Claude Code gets to accept a stop before the request is given up. */
export const STOP_TASK_ANSWER_TIMEOUT_MS = 10_000;

const waitForAnswer = <T>(answer: Promise<T>, timeoutMs: number, signal?: AbortSignal) =>
  new Promise<T>((resolve, reject) => {
    const onAbort = () => fail('The run ended before Claude Code answered');
    const fail = (message: string) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new Error(message));
    };
    const timer = setTimeout(
      () => fail('Claude Code did not answer the stop request in time'),
      timeoutMs,
    );
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    void answer.then((value) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(value);
    });
  });

/**
 * Stop one Claude Code background task through the session's live input: write
 * a `stop_task` control request and wait for Claude Code to accept it. The stop
 * is only proven by the task's `killed` / `stopped` report, which arrives on the
 * session's own output; this resolves when Claude Code took the request.
 *
 * @param send Writes a control request into the session's stdin; `undefined`
 *   once that input has closed.
 * @throws When the input is closed, Claude Code refuses or never answers, or
 *   `signal` aborts first.
 */
export const stopClaudeCodeTask = async (
  send: (request: ClaudeCodeControlRequest) => ClaudeCodeControlRequestHandle | undefined,
  taskId: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<void> => {
  const sent = send({ subtype: 'stop_task', task_id: taskId });
  if (!sent) throw new Error('The Claude Code session no longer takes input');

  const answer = await waitForAnswer(
    sent.response,
    options.timeoutMs ?? STOP_TASK_ANSWER_TIMEOUT_MS,
    options.signal,
  );
  if (answer.subtype === 'error') throw new Error(answer.error);
};
