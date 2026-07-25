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

describe('LocalSystemExecutionRuntime.grepContent', () => {
  // Regression: exercise the REAL callService → denormalizeParams path (do NOT
  // mock runtime.grepContent). Pre-fix, denormalizeParams collapsed grep args to
  // `{cwd, filePattern, output_mode, pattern}` — dropping every filter flag and
  // renaming `glob`→`filePattern` (which the desktop `buildGrepArgs` never reads),
  // so `-i` / typed / glob-scoped searches silently returned 0 matches.
  it('forwards the full param set (glob/type/flags/search-root) to the service', async () => {
    const service = createService({
      grepContent: vi.fn().mockResolvedValue({
        engine: 'rg',
        matches: [],
        success: true,
        total_matches: 0,
      }),
    });
    const runtime = new LocalSystemExecutionRuntime(service);

    await runtime.grepContent({
      '-A': 3,
      '-B': 2,
      '-C': 1,
      '-i': true,
      '-n': true,
      'glob': '**/*.ts',
      'head_limit': 50,
      'multiline': true,
      'output_mode': 'content',
      'path': '/repo',
      'pattern': 'Foo',
      'type': 'ts',
    } as never);

    const forwarded = (service.grepContent as ReturnType<typeof vi.fn>).mock.calls[0][0];

    // Every filter flag the LLM set MUST reach the desktop search — the
    // desktop `buildGrepArgs` reads these exact keys.
    expect(forwarded).toMatchObject({
      '-A': 3,
      '-B': 2,
      '-C': 1,
      '-i': true,
      '-n': true,
      'glob': '**/*.ts',
      'head_limit': 50,
      'multiline': true,
      'output_mode': 'content',
      'pattern': 'Foo',
      'type': 'ts',
    });
    // Search root reaches the desktop `resolveSearchPath` via path/scope/cwd.
    expect(forwarded.path ?? forwarded.scope ?? forwarded.cwd).toBe('/repo');
    // `glob` must NOT be renamed to `filePattern` — the desktop never reads it.
    expect(forwarded.filePattern).toBeUndefined();
  });
});

describe('LocalSystemExecutionRuntime.readFile', () => {
  it('routes uploaded image results onto state.images', async () => {
    const service = createService({
      readLocalFile: vi.fn().mockResolvedValue({
        content: '[Image: cat.png]',
        fileType: 'image/png',
        filename: 'cat.png',
        imageFileId: 'file-1',
        imageUrl: 'https://files.example.com/cat.png',
        isImage: true,
      }),
    });
    const runtime = new LocalSystemExecutionRuntime(service);

    const output = await runtime.readFile({ path: '/tmp/cat.png' });

    expect(output.success).toBe(true);
    // The uploaded reference flows onto state.images so the MessageContent
    // tool-message processor can turn it into an image_url part.
    expect(output.state?.images).toEqual([
      { fileId: 'file-1', mediaType: 'image/png', url: 'https://files.example.com/cat.png' },
    ]);
    expect(output.content).toBe('[Image: cat.png]');
  });

  it('degrades to the text path when the image upload was declined (no url)', async () => {
    const service = createService({
      readLocalFile: vi.fn().mockResolvedValue({
        content: '[Image: cat.png] (upload unavailable — the model cannot view this image)',
        fileType: 'image/png',
        filename: 'cat.png',
        isImage: true,
      }),
    });
    const runtime = new LocalSystemExecutionRuntime(service);

    const output = await runtime.readFile({ path: '/tmp/cat.png' });

    expect(output.success).toBe(true);
    expect(output.state?.images).toBeUndefined();
    expect(output.content).toContain('[Image: cat.png]');
  });

  it('leaves text-file results unchanged (no images on state)', async () => {
    const service = createService({
      readLocalFile: vi.fn().mockResolvedValue({
        content: 'hello',
        fileType: 'txt',
        filename: 'a.txt',
        totalCharCount: 5,
        totalLineCount: 1,
      }),
    });
    const runtime = new LocalSystemExecutionRuntime(service);

    const output = await runtime.readFile({ path: '/tmp/a.txt' });

    expect(output.state?.images).toBeUndefined();
    expect(output.content).toContain('hello');
  });
});
