import { type HeteroControlHandler, registerHeteroControlHandler } from './heteroControl';

/** The control command the server queues to stop one background task. */
export const HETERO_STOP_TASK_COMMAND = 'stop_task';

/** How long Claude Code gets to accept a stop before the handler gives up. */
export const STOP_TASK_ANSWER_TIMEOUT_MS = 10_000;

const waitForAnswer = <T>(answer: Promise<T>, signal: AbortSignal): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const fail = (message: string) => {
      clearTimeout(timer);
      reject(new Error(message));
    };
    const timer = setTimeout(
      () => fail('Claude Code did not answer the stop request in time'),
      STOP_TASK_ANSWER_TIMEOUT_MS,
    );
    const onAbort = () => fail('The run ended before Claude Code answered');
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    void answer.then((value) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    });
  });

/**
 * Stop one Claude Code background task: write a `stop_task` control request
 * into the session's stdin and wait for Claude Code to accept it. The stop is
 * only proven by the task's `stopped` notification, which reaches the server
 * through the run's normal event stream; this reports that CC took the request.
 */
export const stopTaskHandler: HeteroControlHandler = async ({
  params,
  sendControlRequest,
  signal,
}) => {
  const taskId = (params as { taskId?: unknown } | null)?.taskId;
  if (typeof taskId !== 'string' || !taskId) throw new Error('stop_task needs a taskId');

  const sent = sendControlRequest({ subtype: 'stop_task', task_id: taskId });
  if (!sent) throw new Error('The Claude Code session no longer takes input');

  const answer = await waitForAnswer(sent.response, signal);
  if (answer.subtype === 'error') throw new Error(answer.error);
};

registerHeteroControlHandler(HETERO_STOP_TASK_COMMAND, stopTaskHandler);
