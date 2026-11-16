import * as fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TempFileManager } from './tempFileManager';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('node:os', () => ({ tmpdir: () => state.root }));
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof fs>()),
}));

const managers: TempFileManager[] = [];
const createManager = () => {
  const manager = new TempFileManager('parse-');
  managers.push(manager);
  return manager;
};

beforeEach(async () => {
  const { tmpdir } = await vi.importActual<{ tmpdir: () => string }>('node:os');
  state.root = await fs.mkdtemp(path.join(tmpdir(), 'temp-file-manager-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.allSettled(managers.splice(0).map((manager) => manager.cleanup()));
  await fs.rm(state.root, { force: true, recursive: true });
});

describe('TempFileManager', () => {
  it.each(['../../escape.txt', '/absolute.txt', 'nested/file.txt', '..\\windows\\file.txt'])(
    '将 %s 的内容限制在独立临时目录',
    async (name) => {
      const manager = createManager();
      const data = new Uint8Array([0, 128, 255]);
      const filePath = await manager.writeTempFile(data, name);
      expect(path.dirname(path.dirname(filePath))).toBe(state.root);
      expect(path.basename(filePath)).toBe(path.basename(name));
      expect(await fs.readFile(filePath)).toEqual(Buffer.from(data));
      await manager.cleanup();
      await expect(fs.stat(path.dirname(filePath))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await fs.readdir(state.root)).toEqual([]);
    },
  );

  it('写入失败会等待回收并保留原始 cause', async () => {
    const manager = createManager();
    await expect(manager.writeTempFile(new Uint8Array([1]), '.')).rejects.toMatchObject({
      cause: { code: 'EISDIR' },
      message: expect.stringContaining('Failed to write temp file:'),
    });
    expect(await fs.readdir(state.root)).toEqual([]);
  });

  it('创建目录失败也从异步写入返回原始 cause', async () => {
    await fs.rm(state.root, { recursive: true });
    const manager = createManager();
    await expect(manager.writeTempFile(new Uint8Array([1]), 'file.txt')).rejects.toMatchObject({
      cause: { code: 'ENOENT' },
    });
    await manager.cleanup();
  });

  it('回收失败也不覆盖原始写入错误', async () => {
    const manager = createManager();
    vi.spyOn(fs, 'rm').mockRejectedValueOnce(new Error('cleanup failed'));
    await expect(manager.writeTempFile(new Uint8Array([1]), '.')).rejects.toMatchObject({
      cause: { code: 'EISDIR' },
    });
  });

  it('重复回收安全，回收后拒绝新的写入', async () => {
    const manager = createManager();
    await manager.writeTempFile(new Uint8Array([1]), 'first.txt');
    await Promise.all([manager.cleanup(), manager.cleanup()]);
    await manager.cleanup();
    await expect(manager.writeTempFile(new Uint8Array([2]), 'late.txt')).rejects.toThrow();
    expect(await fs.readdir(state.root)).toEqual([]);
  });

  it('尚未写入就回收也会关闭管理器', async () => {
    const manager = createManager();
    await manager.cleanup();
    await expect(manager.writeTempFile(new Uint8Array([1]), 'late.txt')).rejects.toThrow();
    expect(await fs.readdir(state.root)).toEqual([]);
  });

  it('回收等待已开始的真实写入，不留文件且不接纳后起写入', async () => {
    const manager = createManager();
    const realWrite = fs.writeFile;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.spyOn(fs, 'writeFile').mockImplementationOnce(async (...args) => {
      entered();
      await gate;
      return realWrite(...args);
    });
    const writing = manager.writeTempFile(new Uint8Array([1, 2]), 'pending.txt');
    try {
      await Promise.race([
        started,
        writing.then(() => {
          throw new Error('写入应通过异步文件系统边界');
        }),
      ]);
      const cleaning = manager.cleanup();
      await expect(manager.writeTempFile(new Uint8Array([3]), 'late.txt')).rejects.toThrow();
      release();
      const filePath = await writing;
      await cleaning;
      await expect(fs.stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await fs.readdir(state.root)).toEqual([]);
    } finally {
      release();
      await writing;
    }
  });
});
