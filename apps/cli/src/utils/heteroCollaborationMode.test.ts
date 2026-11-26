import { describe, expect, it, vi } from 'vitest';

import { HETERO_SET_COLLABORATION_MODE_COMMAND } from './heteroCollaborationMode';
import { dispatchHeteroControl } from './heteroControl';

const setMode = (params: unknown, setCollaborationMode?: (mode: any) => Promise<void>) =>
  dispatchHeteroControl(
    { command: HETERO_SET_COLLABORATION_MODE_COMMAND, createdAt: 1, id: 'ctl-1', params },
    {
      operationId: 'op-1',
      sendControlRequest: () => undefined,
      setCollaborationMode,
      signal: new AbortController().signal,
    },
  );

describe('set_collaboration_mode control handler', () => {
  it('switches the native Codex thread and reports the mode', async () => {
    const setCollaborationMode = vi.fn().mockResolvedValue(undefined);

    await expect(setMode({ mode: 'plan' }, setCollaborationMode)).resolves.toEqual({
      data: { mode: 'plan' },
      status: 'ok',
    });
    expect(setCollaborationMode).toHaveBeenCalledWith('plan');
  });

  it('refuses an unknown mode and a run that is not a native Codex thread', async () => {
    await expect(setMode({ mode: 'execute' }, vi.fn())).resolves.toMatchObject({
      status: 'error',
    });
    await expect(setMode({ mode: 'default' })).resolves.toMatchObject({
      error: 'This run is not a native Codex thread',
      status: 'error',
    });
  });
});
