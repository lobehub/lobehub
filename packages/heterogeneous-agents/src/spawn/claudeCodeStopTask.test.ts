import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClaudeCodeLiveInput } from './claudeCodeLiveInput';
import { STOP_TASK_ANSWER_TIMEOUT_MS, stopClaudeCodeTask } from './claudeCodeStopTask';

const createLiveInput = () => {
  const stdin = new PassThrough();
  const written: any[] = [];
  stdin.on('data', (chunk: Buffer) => {
    for (const raw of chunk.toString().split('\n')) if (raw) written.push(JSON.parse(raw));
  });
  const live = new ClaudeCodeLiveInput(stdin);
  return { live, send: live.sendControlRequest.bind(live), written };
};

/** Claude Code's answer, as recorded from `claude` 2.1.308. */
const answer = (requestId: string, response: Record<string, unknown>) =>
  `${JSON.stringify({ response: { request_id: requestId, ...response }, type: 'control_response' })}\n`;

describe('stopClaudeCodeTask', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes stop_task and resolves once Claude Code accepts', async () => {
    const { live, send, written } = createLiveInput();
    const stopping = stopClaudeCodeTask(send, 'bys1w0wxo');

    await vi.waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]).toMatchObject({
      request: { subtype: 'stop_task', task_id: 'bys1w0wxo' },
      type: 'control_request',
    });
    live.observe(answer(written[0].request_id, { response: {}, subtype: 'success' }));
    await expect(stopping).resolves.toBeUndefined();
  });

  it('throws what Claude Code answers with', async () => {
    const { live, send, written } = createLiveInput();
    const stopping = stopClaudeCodeTask(send, 'missing');

    await vi.waitFor(() => expect(written).toHaveLength(1));
    live.observe(answer(written[0].request_id, { error: 'No task found', subtype: 'error' }));
    await expect(stopping).rejects.toThrow('No task found');
  });

  it('throws once the input closed', async () => {
    await expect(stopClaudeCodeTask(() => undefined, 't')).rejects.toThrow('no longer takes input');
  });

  it('gives up when Claude Code never answers', async () => {
    vi.useFakeTimers();
    const { send } = createLiveInput();
    const stopping = stopClaudeCodeTask(send, 't');
    const assertion = expect(stopping).rejects.toThrow('did not answer');

    await vi.advanceTimersByTimeAsync(STOP_TASK_ANSWER_TIMEOUT_MS);
    await assertion;
  });

  it('gives up when the signal aborts first', async () => {
    const { send } = createLiveInput();
    const controller = new AbortController();
    const stopping = stopClaudeCodeTask(send, 't', { signal: controller.signal });

    controller.abort();
    await expect(stopping).rejects.toThrow('ended before Claude Code answered');
  });
});
