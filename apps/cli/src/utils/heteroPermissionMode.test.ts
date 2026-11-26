import { PassThrough } from 'node:stream';

import { ClaudeCodeLiveInput } from '@lobechat/heterogeneous-agents/spawn';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { dispatchHeteroControl } from './heteroControl';
import { HETERO_SET_PERMISSION_MODE_COMMAND } from './heteroPermissionMode';

const createLiveInput = () => {
  const stdin = new PassThrough();
  const written: any[] = [];
  stdin.on('data', (chunk: Buffer) => {
    for (const raw of chunk.toString().split('\n')) if (raw) written.push(JSON.parse(raw));
  });
  return { live: new ClaudeCodeLiveInput(stdin), written };
};

const setMode = (live: ClaudeCodeLiveInput | undefined, params: unknown) =>
  dispatchHeteroControl(
    { command: HETERO_SET_PERMISSION_MODE_COMMAND, createdAt: 1, id: 'ctl-1', params },
    {
      operationId: 'op-1',
      sendControlRequest: (request) => live?.sendControlRequest(request),
      signal: new AbortController().signal,
    },
  );

describe('set_permission_mode control handler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('switches the running session and reports the mode Claude Code took', async () => {
    vi.spyOn(process, 'getuid').mockReturnValue(501);
    const { live, written } = createLiveInput();
    const report = setMode(live, { mode: 'acceptEdits' });

    await vi.waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]).toMatchObject({
      request: { mode: 'acceptEdits', subtype: 'set_permission_mode' },
      type: 'control_request',
    });
    // Recorded from `claude` 2.1.308.
    live.observe(
      `${JSON.stringify({
        response: {
          request_id: written[0].request_id,
          response: { mode: 'acceptEdits' },
          subtype: 'success',
        },
        type: 'control_response',
      })}\n`,
    );
    await expect(report).resolves.toEqual({ data: { mode: 'acceptEdits' }, status: 'ok' });
  });

  it('asks for acceptEdits instead of bypass as root', async () => {
    vi.spyOn(process, 'getuid').mockReturnValue(0);
    const { live, written } = createLiveInput();
    void setMode(live, { mode: 'bypassPermissions' });
    await vi.waitFor(() => expect(written).toHaveLength(1));
    expect(written[0].request.mode).toBe('acceptEdits');
  });

  it('refuses an unknown mode and a closed session', async () => {
    const { live } = createLiveInput();
    await expect(setMode(live, { mode: 'dontAsk' })).resolves.toMatchObject({ status: 'error' });
    live.close();
    await expect(setMode(live, { mode: 'plan' })).resolves.toMatchObject({
      error: 'The Claude Code session no longer takes input',
      status: 'error',
    });
  });
});
