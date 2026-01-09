import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IpcContext } from '../base';
import { IpcMethod, IpcService, getIpcContext } from '../base';

const { ipcMainHandleMock } = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcMainHandleMock,
  },
}));

describe('ipc service base', () => {
  beforeEach(() => {
    ipcMainHandleMock.mockClear();
  });

  it('registers handlers and forwards payload/context correctly', async () => {
    class TestService extends IpcService {
      static readonly groupName = 'test';
      public lastCall: { payload: string | undefined; context?: IpcContext } | null = null;

      @IpcMethod()
      ping(payload?: string) {
        this.lastCall = { context: getIpcContext(), payload };
        return 'pong';
      }
    }

    const service = new TestService();

    expect(service).toBeTruthy();
    expect(ipcMainHandleMock).toHaveBeenCalledWith('test.ping', expect.any(Function));

    const handler = ipcMainHandleMock.mock.calls[0][1];
    const fakeSender = { id: 1 } as any;
    const fakeEvent = { sender: fakeSender } as any;

    const result = await handler(fakeEvent, 'hello');

    expect(result).toBe('pong');
    expect(service.lastCall).toEqual({
      context: { event: fakeEvent, sender: fakeSender },
      payload: 'hello',
    });
  });

  it('allows direct method invocation without IPC context', () => {
    class DirectCallService extends IpcService {
      static readonly groupName = 'direct';
      public invokedWith: string | null = null;

      @IpcMethod()
      run(payload: string) {
        this.invokedWith = payload;
        return payload.toUpperCase();
      }
    }

    const service = new DirectCallService();
    const result = service.run('test');

    expect(result).toBe('TEST');
    expect(service.invokedWith).toBe('test');
    expect(ipcMainHandleMock).toHaveBeenCalledWith('direct.run', expect.any(Function));
  });
});
