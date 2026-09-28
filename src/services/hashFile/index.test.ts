import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hashFile } from './index';

const { mockHashLocalFile, mockHashFileStream, desktopFlag } = vi.hoisted(() => ({
  desktopFlag: { value: false },
  mockHashFileStream: vi.fn(async () => 'stream-hash'),
  mockHashLocalFile: vi.fn(async () => 'main-hash'),
}));

vi.mock('@lobechat/const', () => ({
  get isDesktop() {
    return desktopFlag.value;
  },
}));

vi.mock('@/services/electron/localFileService', () => ({
  localFileService: { hashLocalFile: mockHashLocalFile },
}));

vi.mock('./stream', () => ({ hashFileStream: mockHashFileStream }));

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  static script: (worker: FakeWorker, data: { file: File }) => void = () => {};
  terminate = vi.fn();

  constructor() {
    super();
    FakeWorker.instances.push(this);
  }

  postMessage(data: { file: File }) {
    queueMicrotask(() => FakeWorker.script(this, data));
  }

  emit(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
}

const file = new File(['abc'], 'a.bin');

describe('hashFile', () => {
  const originalWorker = globalThis.Worker;

  beforeEach(() => {
    vi.clearAllMocks();
    FakeWorker.instances = [];
    desktopFlag.value = false;
    (globalThis as any).Worker = FakeWorker;
  });

  afterEach(() => {
    (globalThis as any).Worker = originalWorker;
    delete (globalThis as any).window.electron;
  });

  it('hashes in a worker on web and relays progress', async () => {
    const onProgress = vi.fn();
    FakeWorker.script = (worker) => {
      worker.emit({ progress: 50, type: 'progress' });
      worker.emit({ hash: 'worker-hash', type: 'done' });
    };

    await expect(hashFile(file, undefined, onProgress)).resolves.toBe('worker-hash');

    expect(onProgress).toHaveBeenCalledWith(50);
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(mockHashFileStream).not.toHaveBeenCalled();
  });

  it('rejects worker errors', async () => {
    FakeWorker.script = (worker) => worker.emit({ message: 'boom', type: 'error' });

    await expect(hashFile(file)).rejects.toThrow('boom');
  });

  it('terminates the worker when aborted', async () => {
    const controller = new AbortController();
    FakeWorker.script = () => controller.abort();

    await expect(hashFile(file, controller.signal)).rejects.toThrow();
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalled();
  });

  it('falls back to inline streaming without Worker support', async () => {
    (globalThis as any).Worker = undefined;

    await expect(hashFile(file)).resolves.toBe('stream-hash');
  });

  it('hashes in the Electron main process when a local path resolves', async () => {
    desktopFlag.value = true;
    (globalThis as any).window.electron = { webUtils: { getPathForFile: () => '/abs/a.bin' } };

    await expect(hashFile(file)).resolves.toBe('main-hash');

    expect(mockHashLocalFile).toHaveBeenCalledWith({ path: '/abs/a.bin' });
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('uses the worker on Electron for in-memory files without a path', async () => {
    desktopFlag.value = true;
    (globalThis as any).window.electron = { webUtils: { getPathForFile: () => '' } };
    FakeWorker.script = (worker) => worker.emit({ hash: 'worker-hash', type: 'done' });

    await expect(hashFile(file)).resolves.toBe('worker-hash');
    expect(mockHashLocalFile).not.toHaveBeenCalled();
  });
});
