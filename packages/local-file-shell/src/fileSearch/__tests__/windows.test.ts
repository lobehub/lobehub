import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolDetector } from '../../toolDetector';
import { WindowsSearchServiceImpl } from '../impl/windows';

vi.mock('node:os', () => ({
  homedir: vi.fn().mockReturnValue('C:\\Users\\test'),
}));

vi.mock('../../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

const execaMock = vi.fn();
vi.mock('execa', () => ({
  execa: (...args: unknown[]) => execaMock(...args),
}));

vi.mock('node:fs/promises', () => ({
  stat: vi.fn().mockResolvedValue({
    atime: new Date(),
    birthtime: new Date(),
    isDirectory: () => false,
    mtime: new Date(),
    size: 0,
  }),
}));

describe('WindowsFileSearch', () => {
  beforeEach(() => {
    execaMock.mockReset();
  });

  it('parses LF-separated PowerShell output as individual file paths', async () => {
    const toolDetector: ToolDetector = {
      getBestTool: vi.fn().mockResolvedValue('powershell'),
    };
    execaMock.mockResolvedValue({
      exitCode: 0,
      stdout: 'C:\\Users\\test\\first.txt\nC:\\Users\\test\\second.txt\n',
    });

    const impl = new WindowsSearchServiceImpl(toolDetector);
    const results = await impl.search({ keywords: 'test' });

    expect(results.map(({ path }) => path)).toEqual([
      'C:\\Users\\test\\first.txt',
      'C:\\Users\\test\\second.txt',
    ]);
  });
});
