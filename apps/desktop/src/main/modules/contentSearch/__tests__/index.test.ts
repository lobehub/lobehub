import * as os from 'node:os';
import { describe, expect, it, vi } from 'vitest';

import { LinuxContentSearchImpl } from '../impl/linux';
import { MacOSContentSearchImpl } from '../impl/macOS';
import { WindowsContentSearchImpl } from '../impl/windows';
import { createContentSearchImpl } from '../index';

// Mock os module before imports
vi.mock('node:os', () => ({
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

describe('createContentSearchImpl', () => {
  it('should create MacOSContentSearchImpl on darwin', () => {
    vi.mocked(os.platform).mockReturnValue('darwin');

    const impl = createContentSearchImpl();

    expect(impl).toBeInstanceOf(MacOSContentSearchImpl);
  });

  it('should create WindowsContentSearchImpl on win32', () => {
    vi.mocked(os.platform).mockReturnValue('win32');

    const impl = createContentSearchImpl();

    expect(impl).toBeInstanceOf(WindowsContentSearchImpl);
  });

  it('should create LinuxContentSearchImpl on linux', () => {
    vi.mocked(os.platform).mockReturnValue('linux');

    const impl = createContentSearchImpl();

    expect(impl).toBeInstanceOf(LinuxContentSearchImpl);
  });

  it('should create LinuxContentSearchImpl on unknown platform', () => {
    vi.mocked(os.platform).mockReturnValue('freebsd' as any);

    const impl = createContentSearchImpl();

    expect(impl).toBeInstanceOf(LinuxContentSearchImpl);
  });

  it('should pass toolDetectorManager to implementation', () => {
    vi.mocked(os.platform).mockReturnValue('linux');
    const mockManager = {} as any;

    const impl = createContentSearchImpl(mockManager);

    expect((impl as any).toolDetectorManager).toBe(mockManager);
  });
});
