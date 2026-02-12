import { platform } from 'node:os';
import { describe, expect, it, vi } from 'vitest';

import { LinuxSearchServiceImpl } from '../impl/linux';
import { MacOSSearchServiceImpl } from '../impl/macOS';
import { WindowsSearchServiceImpl } from '../impl/windows';
import { createFileSearchModule } from '../index';

// Mock os module before imports
vi.mock('node:os', () => ({
  homedir: vi.fn().mockReturnValue('/home/user'),
  platform: vi.fn().mockReturnValue('linux'),
}));

// Mock logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe('createFileSearchModule', () => {
  it('should create MacOSSearchServiceImpl on darwin', () => {
    vi.mocked(platform).mockReturnValue('darwin');

    const impl = createFileSearchModule();

    expect(impl).toBeInstanceOf(MacOSSearchServiceImpl);
  });

  it('should create WindowsSearchServiceImpl on win32', () => {
    vi.mocked(platform).mockReturnValue('win32');

    const impl = createFileSearchModule();

    expect(impl).toBeInstanceOf(WindowsSearchServiceImpl);
  });

  it('should create LinuxSearchServiceImpl on linux', () => {
    vi.mocked(platform).mockReturnValue('linux');

    const impl = createFileSearchModule();

    expect(impl).toBeInstanceOf(LinuxSearchServiceImpl);
  });

  it('should create LinuxSearchServiceImpl on unknown platform', () => {
    vi.mocked(platform).mockReturnValue('freebsd' as any);

    const impl = createFileSearchModule();

    expect(impl).toBeInstanceOf(LinuxSearchServiceImpl);
  });

  it('should pass toolDetectorManager to implementation', () => {
    vi.mocked(platform).mockReturnValue('linux');
    const mockManager = {} as any;

    const impl = createFileSearchModule(mockManager);

    expect((impl as any).toolDetectorManager).toBe(mockManager);
  });
});
