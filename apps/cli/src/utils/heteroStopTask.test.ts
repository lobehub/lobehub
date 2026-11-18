import { PassThrough } from 'node:stream';

import { ClaudeCodeLiveInput } from '@lobechat/heterogeneous-agents/spawn';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { dispatchHeteroControl } from './heteroControl';
import { HETERO_STOP_TASK_COMMAND, STOP_TASK_ANSWER_TIMEOUT_MS } from './heteroStopTask';

const createLiveInput = () => {
  const stdin = new PassThrough();
  const written: any[] = [];
  stdin.on('data', (chunk: Buffer) => {
    for (const raw of chunk.toString().split('\n')) if (raw) written.push(JSON.parse(raw));
  });
  return { live: new ClaudeCodeLiveInput(stdin), written };
};

/** Claude Code's answer, as recorded from `claude` 2.1.308. */
const answer = (requestId: string, response: Record<string, unknown>) =>
  `${JSON.stringify({ response: { request_id: requestId, ...response }, type: 'control_response' })}\n`;

const stop = (
  live: ClaudeCodeLiveInput | undefined,
  params: unknown,
  signal = new AbortController().signal,
) =>
  dispatchHeteroControl(
    { command: HETERO_STOP_TASK_COMMAND, createdAt: 1, id: 'ctl-1', params },
    {
      operationId: 'op-1',
      sendControlRequest: (request) => live?.sendControlRequest(request),
      signal,
    },
  );

describe('stop_task control handler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes stop_task into the Claude Code stdin and reports ok once CC accepts', async () => {
    const { live, written } = createLiveInput();
    const report = stop(live, { taskId: 'bys1w0wxo' });

    await vi.waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]).toEqual({
      request: { subtype: 'stop_task', task_id: 'bys1w0wxo' },
      request_id: expect.any(String),
      type: 'control_request',
    });
    live.observe(answer(written[0].request_id, { response: {}, subtype: 'success' }));

    await expect(report).resolves.toEqual({ status: 'ok' });
  });

  it('reports the error Claude Code answers with', async () => {
    const { live, written } = createLiveInput();
    const report = stop(live, { taskId: 'missing' });

    await vi.waitFor(() => expect(written).toHaveLength(1));
    live.observe(answer(written[0].request_id, { error: 'No task found', subtype: 'error' }));

    await expect(report).resolves.toEqual({ error: 'No task found', status: 'error' });
  });

  it('rejects a request without a task id', async () => {
    const { live, written } = createLiveInput();
    await expect(stop(live, {})).resolves.toMatchObject({ status: 'error' });
    expect(written).toEqual([]);
  });

  it('fails when the session no longer takes input', async () => {
    await expect(stop(undefined, { taskId: 't' })).resolves.toEqual({
      error: 'The Claude Code session no longer takes input',
      status: 'error',
    });
  });

  it('gives up when Claude Code never answers', async () => {
    vi.useFakeTimers();
    const { live } = createLiveInput();
    const report = stop(live, { taskId: 't' });

    await vi.advanceTimersByTimeAsync(STOP_TASK_ANSWER_TIMEOUT_MS);
    await expect(report).resolves.toMatchObject({ status: 'error' });
  });

  it('gives up when the run ends first', async () => {
    const { live } = createLiveInput();
    const controller = new AbortController();
    const report = stop(live, { taskId: 't' }, controller.signal);

    controller.abort();
    await expect(report).resolves.toEqual({
      error: 'The run ended before Claude Code answered',
      status: 'error',
    });
  });
});
