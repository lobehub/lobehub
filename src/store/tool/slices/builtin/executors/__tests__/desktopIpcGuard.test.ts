import type { IBuiltinToolExecutor } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withDesktopIpcGuard } from '../desktopIpcGuard';

const ipcMocks = vi.hoisted(() => ({
  reason: undefined as 'not-desktop' | 'preload-missing' | undefined,
  track: vi.fn(),
}));

vi.mock('@/utils/electron/ipc', () => ({
  getDesktopIpcUnavailableReason: () => ipcMocks.reason,
  trackDesktopIpcUnavailable: ipcMocks.track,
}));

const createExecutor = () =>
  ({
    getApiNames: () => ['readFile'],
    hasApi: (apiName: string) => apiName === 'readFile',
    identifier: 'lobe-local-system',
    invoke: vi.fn().mockResolvedValue({ content: 'file body', success: true }),
    onAfterCall: vi.fn(),
    onBeforeCall: vi.fn(),
  }) satisfies IBuiltinToolExecutor;

const ctx = { messageId: 'tool-message-id' };

describe('withDesktopIpcGuard', () => {
  beforeEach(() => {
    ipcMocks.reason = undefined;
    ipcMocks.track.mockClear();
  });

  it('runs the executor when the desktop bridge is available', async () => {
    const executor = createExecutor();
    const guarded = withDesktopIpcGuard(executor, 'Local System');

    await expect(guarded.invoke('readFile', { path: '/a' }, ctx)).resolves.toEqual({
      content: 'file body',
      success: true,
    });
    expect(executor.invoke).toHaveBeenCalledWith('readFile', { path: '/a' }, ctx);
    expect(ipcMocks.track).not.toHaveBeenCalled();
  });

  it('tells the model to hand a web-browser call back to the desktop app, and records it', async () => {
    ipcMocks.reason = 'not-desktop';
    const executor = createExecutor();
    const guarded = withDesktopIpcGuard(executor, 'Local System');

    const result = await guarded.invoke('readFile', { path: '/a' }, ctx);

    expect(executor.invoke).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      error: { body: { reason: 'not-desktop' }, type: 'DesktopRuntimeUnavailable' },
      success: false,
    });
    expect(result.content).toBe(
      "Local System is unavailable: this conversation is running in a web browser, which cannot reach the user's computer. Do not retry Local System calls in this run; tell the user to continue this conversation in the LobeHub desktop app, then retry.",
    );
    expect(result.error?.message).toBe(result.content);
    expect(ipcMocks.track).toHaveBeenCalledWith('not-desktop', {
      api_name: 'readFile',
      identifier: 'lobe-local-system',
      source: 'tool',
    });
  });

  it('asks for a reload or restart when a desktop window lost its bridge', async () => {
    ipcMocks.reason = 'preload-missing';
    const guarded = withDesktopIpcGuard(createExecutor(), 'Computer Use');

    const result = await guarded.invoke('readFile', {}, ctx);

    expect(result.success).toBe(false);
    expect(result.content).toMatch(
      /^Computer Use is unavailable: .*reload the window \(Cmd\/Ctrl\+R\) to reconnect it, or restart LobeHub Desktop/,
    );
    expect(ipcMocks.track).toHaveBeenCalledWith('preload-missing', expect.anything());
  });

  it('keeps the executor identity and lifecycle hooks, which also fire for calls run elsewhere', async () => {
    ipcMocks.reason = 'not-desktop';
    const executor = createExecutor();
    const guarded = withDesktopIpcGuard(executor, 'Local System');

    expect(guarded.identifier).toBe('lobe-local-system');
    expect(guarded.hasApi('readFile')).toBe(true);
    expect(guarded.getApiNames()).toEqual(['readFile']);

    const hookCtx = { apiName: 'readFile', identifier: 'lobe-local-system', params: {} } as any;
    await guarded.onBeforeCall?.(hookCtx);
    await guarded.onAfterCall?.({ ...hookCtx, result: { success: true } });
    expect(executor.onBeforeCall).toHaveBeenCalledWith(hookCtx);
    expect(executor.onAfterCall).toHaveBeenCalled();
  });
});
