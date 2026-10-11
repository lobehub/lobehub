import { ComfyApi, PromptBuilder } from '@saintno/comfyui-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { executeComfyUIWorkflow } from '@/server/services/comfyui/core/workflowExecution';

const workflow = new PromptBuilder(
  {
    selected: { _meta: { title: 'Chosen output' }, class_type: 'SaveImage', inputs: {} },
    other: { _meta: { title: 'Other output' }, class_type: 'SaveImage', inputs: {} },
  },
  [],
  ['images'],
).setOutputNode('images', 'selected');
const selected = { filename: 'chosen.png', subfolder: '', type: 'output' };
const completed = {
  job: {
    outputs: {
      other: { images: [{ ...selected, filename: 'wrong.png' }] },
      selected: { images: [selected] },
    },
    status: { completed: true, messages: [], status_str: 'success' },
  },
};

let client: ComfyApi;
beforeEach(() => {
  vi.useFakeTimers();
  client = new ComfyApi('http://comfyui.test');
  vi.spyOn(client, 'appendPrompt').mockResolvedValue({
    node_errors: {},
    number: 0,
    prompt_id: 'job',
  });
});
afterEach(() => {
  client.destroy();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function emit(type: string, detail: Record<string, unknown> = {}) {
  client.dispatchEvent(new CustomEvent(type, { detail }));
}

describe('ComfyUI workflow tracking', () => {
  it('recovers the selected output after disconnection without resubmitting a queued job', async () => {
    const fetchHistory = vi
      .spyOn(client, 'fetchApi')
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValue(Response.json(completed));
    const result = executeComfyUIWorkflow(client, workflow);
    await vi.advanceTimersByTimeAsync(0);
    emit('disconnected');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toMatchObject({ images: { images: [selected] } });
    expect(client.appendPrompt).toHaveBeenCalledTimes(1);
    expect(fetchHistory.mock.calls.every(([route]) => route === '/history/job')).toBe(true);
    const finishedPolls = fetchHistory.mock.calls.length;
    emit('disconnected');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchHistory).toHaveBeenCalledTimes(finishedPolls);
  });

  it('finds completed and cached output even when all completion events were lost', async () => {
    vi.spyOn(client, 'fetchApi').mockResolvedValue(Response.json(completed));
    expect(await executeComfyUIWorkflow(client, workflow)).toMatchObject({
      images: { images: [selected] },
    });
  });

  it('ignores failures from other jobs, but reports a genuine execution error for its own job', async () => {
    vi.spyOn(client, 'fetchApi').mockResolvedValue(Response.json({}));
    const result = executeComfyUIWorkflow(client, workflow);
    const assertion = expect(result).rejects.toThrow('CUDA out of memory');
    await vi.advanceTimersByTimeAsync(0);
    emit('execution_error', { exception_message: 'unrelated failure', prompt_id: 'other-job' });
    emit('disconnected');
    emit('execution_error', { exception_message: 'CUDA out of memory', prompt_id: 'job' });
    await assertion;
  });

  it.each(['execution_error', 'execution_interrupted'])(
    'recovers %s from history after socket loss',
    async (event) => {
      vi.spyOn(client, 'fetchApi').mockResolvedValue(
        Response.json({
          job: {
            outputs: {},
            status: {
              completed: false,
              messages: [[event, { exception_message: 'Server execution stopped' }]],
              status_str: 'error',
            },
          },
        }),
      );
      await expect(executeComfyUIWorkflow(client, workflow)).rejects.toThrow(
        'Server execution stopped',
      );
    },
  );

  it('recovers after HTTP becomes temporarily unreachable without submitting another job', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(client, 'fetchApi')
      .mockRejectedValueOnce(new TypeError('connection reset'))
      .mockResolvedValue(Response.json(completed));
    const result = executeComfyUIWorkflow(client, workflow);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toMatchObject({ images: { images: [selected] } });
    expect(client.appendPrompt).toHaveBeenCalledTimes(1);
  });

  it('bounds tracking when the server never becomes reachable again and stops polling', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchHistory = vi.spyOn(client, 'fetchApi').mockRejectedValue(new TypeError('offline'));
    const result = executeComfyUIWorkflow(client, workflow);
    const assertion = expect(result).rejects.toThrow(
      'The job may still be running; check ComfyUI before retrying',
    );
    await vi.advanceTimersByTimeAsync(300_000);
    await assertion;
    const requests = fetchHistory.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchHistory).toHaveBeenCalledTimes(requests);
    expect(client.appendPrompt).toHaveBeenCalledTimes(1);
  });

  it('does not retry an uncertain submission failure', async () => {
    vi.spyOn(client, 'appendPrompt').mockRejectedValue(new TypeError('submission connection lost'));
    await expect(executeComfyUIWorkflow(client, workflow)).rejects.toThrow(
      'submission connection lost',
    );
    expect(client.appendPrompt).toHaveBeenCalledTimes(1);
  });

  it('does not silently substitute another output when the selected node is absent', async () => {
    vi.spyOn(client, 'fetchApi').mockResolvedValue(
      Response.json({
        job: { ...completed.job, outputs: { other: completed.job.outputs.other } },
      }),
    );
    await expect(executeComfyUIWorkflow(client, workflow)).rejects.toThrow(
      'completed without output node selected',
    );
  });
});
