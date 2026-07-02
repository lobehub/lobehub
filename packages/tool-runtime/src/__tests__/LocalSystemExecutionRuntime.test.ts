import { describe, expect, it, vi } from 'vitest';

import {
  type ILocalSystemService,
  LocalSystemExecutionRuntime,
} from '../LocalSystemExecutionRuntime';

const createService = (overrides: Partial<ILocalSystemService> = {}): ILocalSystemService => ({
  editLocalFile: vi.fn(),
  getCommandOutput: vi.fn(),
  globFiles: vi.fn(),
  grepContent: vi.fn(),
  killCommand: vi.fn(),
  listLocalFiles: vi.fn(),
  moveLocalFiles: vi.fn(),
  readLocalFile: vi.fn(),
  readLocalFiles: vi.fn(),
  renameLocalFile: vi.fn(),
  runCommand: vi.fn(),
  searchLocalFiles: vi.fn(),
  writeFile: vi.fn(),
  ...overrides,
});

describe('LocalSystemExecutionRuntime.editFile', () => {
  it('surfaces the underlying error message instead of UNKNOWN_EXEC_ERROR', async () => {
    const service = createService({
      editLocalFile: vi.fn().mockResolvedValue({
        error: 'The specified old_string was not found in the file',
        replacements: 0,
        success: false,
      }),
    });
    const runtime = new LocalSystemExecutionRuntime(service);

    const output = await runtime.editFile({
      all: false,
      path: 'C:/foo.ts',
      replace: 'bar',
      search: 'foo',
    });

    expect(output.success).toBe(true);
    expect(output.content).toBe('The specified old_string was not found in the file');
    expect(output.content).not.toContain('UNKNOWN_EXEC_ERROR');
  });

  it('returns a formatted success result on a successful edit', async () => {
    const service = createService({
      editLocalFile: vi.fn().mockResolvedValue({
        diffText: 'diff',
        linesAdded: 1,
        linesDeleted: 1,
        replacements: 1,
        success: true,
      }),
    });
    const runtime = new LocalSystemExecutionRuntime(service);

    const output = await runtime.editFile({
      all: false,
      path: 'C:/foo.ts',
      replace: 'bar',
      search: 'foo',
    });

    expect(output.success).toBe(true);
    expect((output.state as { replacements: number }).replacements).toBe(1);
    expect(output.content).not.toContain('UNKNOWN_EXEC_ERROR');
  });
});

describe('LocalSystemExecutionRuntime.globFiles', () => {
  it('forwards limit into the local-system service glob params', async () => {
    const service = createService({
      globFiles: vi.fn().mockResolvedValue({
        files: ['/tmp/a.ts'],
        success: true,
        total_files: 1,
      }),
    });
    const runtime = new LocalSystemExecutionRuntime(service);

    await runtime.globFiles({
      directory: '/tmp',
      limit: 42,
      pattern: '**/*.ts',
    });

    expect(service.globFiles).toHaveBeenCalledWith({
      limit: 42,
      pattern: '**/*.ts',
      scope: '/tmp',
    });
  });
});
