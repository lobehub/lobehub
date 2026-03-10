import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { describe, expect, it, vi } from 'vitest';

import { TempFileManager } from '../tempFileManager';

// Mock node modules
vi.mock('node:fs');
vi.mock('node:os');
vi.mock('node:path', () => ({
  join: (...args: string[]) => args.join('/'),
  default: {
    join: (...args: string[]) => args.join('/'),
  },
}));

describe('TempFileManager', () => {
  const mockTmpDir = '/tmp';
  const mockDirname = 'test-';
  const mockFullTmpDir = '/tmp/test-xyz';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tmpdir).mockReturnValue(mockTmpDir);
    vi.mocked(mkdtempSync).mockReturnValue(mockFullTmpDir);
    vi.mocked(existsSync).mockReturnValue(true);
  });

  it('should create temp directory on initialization', () => {
    new TempFileManager(mockDirname);

    expect(tmpdir).toHaveBeenCalled();
    expect(mkdtempSync).toHaveBeenCalledWith(`${mockTmpDir}/${mockDirname}`);
  });

  it('should write temp file successfully', async () => {
    const manager = new TempFileManager(mockDirname);
    const testData = new Uint8Array([1, 2, 3]);
    const fileName = 'test.txt';

    const filePath = await manager.writeTempFile(testData, fileName);

    expect(writeFileSync).toHaveBeenCalledWith(`${mockFullTmpDir}/${fileName}`, testData);
    expect(filePath).toBe(`${mockFullTmpDir}/${fileName}`);
  });

  it('should cleanup on write failure', async () => {
    const manager = new TempFileManager(mockDirname);
    const testData = new Uint8Array([1, 2, 3]);
    const fileName = 'test.txt';

    vi.mocked(writeFileSync).mockImplementation(() => {
      throw new Error('Write failed');
    });

    await expect(manager.writeTempFile(testData, fileName)).rejects.toThrow(
      'Failed to write temp file: Write failed',
    );

    expect(existsSync).toHaveBeenCalledWith(mockFullTmpDir);
    expect(rmSync).toHaveBeenCalledWith(mockFullTmpDir, { force: true, recursive: true });
  });

  it('should cleanup temp directory', () => {
    const manager = new TempFileManager(mockDirname);
    vi.mocked(existsSync).mockReturnValue(true);

    manager.cleanup();

    expect(existsSync).toHaveBeenCalledWith(mockFullTmpDir);
    expect(rmSync).toHaveBeenCalledWith(mockFullTmpDir, { force: true, recursive: true });
  });

  it('should skip cleanup if directory does not exist', () => {
    const manager = new TempFileManager(mockDirname);
    vi.mocked(existsSync).mockReturnValue(false);

    manager.cleanup();

    expect(existsSync).toHaveBeenCalledWith(mockFullTmpDir);
    expect(rmSync).not.toHaveBeenCalled();
  });

  it('should register cleanup hooks on process events', () => {
    const processOnSpy = vi.spyOn(process, 'on');
    new TempFileManager(mockDirname);

    expect(processOnSpy).toHaveBeenCalledWith('exit', expect.any(Function));
    expect(processOnSpy).toHaveBeenCalledWith('uncaughtException', expect.any(Function));
    expect(processOnSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(processOnSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
  });
});
