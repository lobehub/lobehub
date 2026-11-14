import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isIpcErrorEnvelope } from '~common/ipcError';

import type { IpcContext } from '../base';
import { getIpcContext, IpcMethod, IpcService } from '../base';

const { ipcMainHandleMock } = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcMainHandleMock,
  },
}));

const rendererFrame = (url = 'app://renderer/chat', parent: unknown = null) =>
  ({ parent, url }) as any;

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
    const fakeEvent = { sender: fakeSender, senderFrame: rendererFrame() } as any;

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
  describe('sender validation', () => {
    class GuardedService extends IpcService {
      static readonly groupName = 'guarded';
      public calls = 0;

      @IpcMethod()
      run() {
        this.calls += 1;
        return 'ran';
      }
    }

    // The handler registry is a process-wide singleton, so the channel is
    // registered once and the captured handler is reused across cases.
    const service = new GuardedService();
    const handler = ipcMainHandleMock.mock.calls.find(([channel]) => channel === 'guarded.run')![1];

    const invoke = (senderFrame: unknown) => {
      service.calls = 0;
      return { result: handler({ sender: { id: 1 }, senderFrame } as any), service };
    };

    it('runs the handler for the renderer top-level frame', async () => {
      const { result, service } = invoke(rendererFrame());

      await expect(result).resolves.toBe('ran');
      expect(service.calls).toBe(1);
    });

    it.each([
      ['a subframe of the renderer', rendererFrame('app://renderer/', rendererFrame())],
      ['a foreign origin', rendererFrame('https://evil.example/')],
      ['a local file page', rendererFrame('file:///tmp/index.html')],
      ['another app:// host', rendererFrame('app://other/')],
      ['an unparsable url', rendererFrame('')],
      ['a destroyed frame', null],
    ])('rejects %s without running the handler', async (_label, frame) => {
      const { result, service } = invoke(frame);

      expect(isIpcErrorEnvelope(await result)).toBe(true);
      expect(service.calls).toBe(0);
    });
  });
});
