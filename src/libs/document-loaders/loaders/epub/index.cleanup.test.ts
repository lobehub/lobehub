// @vitest-environment node
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TempFileManager } from '@/server/utils/tempFileManager';

import { EPubLoader } from './index';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('node:os', () => ({ tmpdir: () => state.root }));

beforeEach(async () => {
  const { tmpdir } = await vi.importActual<{ tmpdir: () => string }>('node:os');
  state.root = await mkdtemp(path.join(tmpdir(), 'epub-cleanup-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(state.root, { force: true, recursive: true });
});

describe('EPubLoader 临时文件回收', () => {
  it.each([false, true])('解析失败=%s 时，等待真实回收后才结束', async (fails) => {
    const content = fails
      ? new Uint8Array([0, 1, 2])
      : await readFile(path.join(__dirname, '__tests__/demo.epub'));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const cleaning = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const cleanup = TempFileManager.prototype.cleanup;
    vi.spyOn(TempFileManager.prototype, 'cleanup').mockImplementation(async function (
      this: TempFileManager,
    ) {
      entered();
      await gate;
      await cleanup.call(this);
    });

    let settled = false;
    const result = EPubLoader(content)
      .then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      )
      .finally(() => {
        settled = true;
      });
    try {
      await cleaning;
      await setImmediate();
      expect(await readdir(state.root)).toHaveLength(1);
      expect(settled).toBe(false);
    } finally {
      release();
      await result;
      // 即使旧调用方没有等待回收，红灯测试也必须收尾真实 fs 操作。
      await Promise.all(
        vi.mocked(TempFileManager.prototype.cleanup).mock.results.map((r) => r.value),
      );
    }

    if (fails)
      expect(await result).toMatchObject({
        error: { message: expect.stringContaining('EPubLoader error:') },
      });
    else
      expect(await result).toMatchObject({
        value: expect.arrayContaining([
          expect.objectContaining({ pageContent: expect.any(String) }),
        ]),
      });
    expect(await readdir(state.root)).toEqual([]);
  });
});
