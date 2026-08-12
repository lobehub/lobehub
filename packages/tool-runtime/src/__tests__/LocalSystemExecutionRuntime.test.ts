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

  it('applies the agent-facing default glob limit', async () => {
    const service = createService({
      globFiles: vi.fn().mockResolvedValue({ files: [], success: true, total_files: 0 }),
    });
    const runtime = new LocalSystemExecutionRuntime(service);

    await runtime.globFiles({ directory: '/tmp', pattern: '**/*' });

    expect(service.globFiles).toHaveBeenCalledWith({
      limit: 1000,
      pattern: '**/*',
      scope: '/tmp',
    });
  });

  it('caps oversized agent-facing glob limits without changing the file search service', async () => {
    const service = createService({
      globFiles: vi.fn().mockResolvedValue({ files: [], success: true, total_files: 0 }),
    });
    const runtime = new LocalSystemExecutionRuntime(service);

    await runtime.globFiles({ directory: '/tmp', limit: 5000, pattern: '**/*' });

    expect(service.globFiles).toHaveBeenCalledWith({
      limit: 1000,
      pattern: '**/*',
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
    });

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

describe('LocalSystemExecutionRuntime.executeToolCall — working directory anchoring', () => {
  const WD = '/Users/me/project';

  // Regression: the desktop executor spawned shells in the app install
  // directory because no cwd ever reached the IPC layer. The runner spawns in
  // `params.cwd`, so it MUST carry the agent's working directory.
  it('injects the working directory as runCommand cwd and maps run_in_background', async () => {
    const service = createService({
      runCommand: vi.fn().mockResolvedValue({ exit_code: 0, stdout: 'ok', success: true }),
    });
    const runtime = new LocalSystemExecutionRuntime(service);

    await runtime.executeToolCall(
      'runCommand',
      { command: 'ls', run_in_background: true },
      { workingDirectory: WD },
    );

    expect(service.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'ls', cwd: WD, run_in_background: true }),
    );
  });

  it('keeps a server-injected absolute cwd (gateway path, trustArgsCwd)', async () => {
    const service = createService({
      runCommand: vi.fn().mockResolvedValue({ exit_code: 0, success: true }),
    });
    const runtime = new LocalSystemExecutionRuntime(service);

    await runtime.executeToolCall(
      'runCommand',
      { command: 'ls', cwd: '/from/server' },
      { trustArgsCwd: true },
    );

    expect(service.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'ls', cwd: '/from/server' }),
    );
  });

  // Security: an agent with no configured working directory leaves BOTH
  // `workingDirectory` and `trustArgsCwd` unset on the renderer path, which is
  // exactly the shape a gateway call has. Inferring trust from the missing
  // working directory would hand this call the model's own `cwd`, so the
  // contract has to be explicit.
  it.each([
    ['runCommand', { command: 'cat passwd', cwd: '/etc' }, 'runCommand'],
    ['readFile', { cwd: '/etc', path: 'passwd' }, 'readLocalFile'],
  ] as const)(
    'drops a model-supplied cwd for %s when the caller did not vouch for it',
    async (api, args, serviceMethod) => {
      const service = createService({
        [serviceMethod]: vi.fn().mockResolvedValue({ success: true }),
      });
      const runtime = new LocalSystemExecutionRuntime(service);

      await runtime.executeToolCall(api, { ...args });

      expect(service[serviceMethod]).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: undefined }),
      );
    },
  );

  it('drops a model-supplied cwd from grepContent when the caller did not vouch for it', async () => {
    const grepContent = vi.fn().mockResolvedValue({ matches: [], success: true, total_matches: 0 });
    const runtime = new LocalSystemExecutionRuntime(createService({ grepContent }));

    await runtime.executeToolCall('grepContent', { cwd: '/etc', pattern: 'root', scope: '.' });

    // `cwd` outranks `path` as the search root downstream, so the model's value
    // must not survive — the audited relative scope is what remains.
    const forwarded = grepContent.mock.calls[0][0];
    expect(forwarded.cwd).not.toBe('/etc');
    expect(forwarded.path).not.toBe('/etc');
  });

  // Security: the out-of-scope intervention audit inspects path/scope fields
  // but not `cwd`. A model-supplied cwd on the audited (renderer) path could
  // smuggle a relative path outside the workspace — it must be ignored.
  it('ignores a model-supplied cwd when a trusted working directory is present', async () => {
    const service = createService({
      runCommand: vi.fn().mockResolvedValue({ exit_code: 0, success: true }),
    });
    const runtime = new LocalSystemExecutionRuntime(service);

    await runtime.executeToolCall(
      'runCommand',
      { command: 'cat passwd', cwd: '/etc' },
      { workingDirectory: WD },
    );

    expect(service.runCommand).toHaveBeenCalledWith(expect.objectContaining({ cwd: WD }));
  });

  it('ignores a model-supplied cwd for file ops on the audited path', async () => {
    const service = createService({
      readLocalFile: vi.fn().mockResolvedValue({ content: '', success: true }),
    });
    const runtime = new LocalSystemExecutionRuntime(service);

    await runtime.executeToolCall(
      'readFile',
      { cwd: '/etc', path: 'passwd' },
      { workingDirectory: WD },
    );

    expect(service.readLocalFile).toHaveBeenCalledWith(expect.objectContaining({ cwd: WD }));
  });

  it('ignores a model-supplied grep/glob cwd alias on the audited path', async () => {
    const service = createService({
      globFiles: vi.fn().mockResolvedValue({ files: [], success: true, total_files: 0 }),
      grepContent: vi.fn().mockResolvedValue({ matches: [], success: true, total_matches: 0 }),
    });
    const runtime = new LocalSystemExecutionRuntime(service);

    await runtime.executeToolCall(
      'globFiles',
      { cwd: '/etc', pattern: '*' },
      { workingDirectory: WD },
    );
    expect(service.globFiles).toHaveBeenCalledWith(expect.objectContaining({ scope: WD }));

    await runtime.executeToolCall(
      'grepContent',
      { cwd: '/etc', pattern: 'root' },
      { workingDirectory: WD },
    );
    const grepForwarded = (service.grepContent as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(grepForwarded.cwd).toBe(WD);
    expect(grepForwarded.path).toBe(WD);
  });

  it.each([
    [
      'readFile',
      { path: 'src/a.ts' },
      'readLocalFile',
      { cwd: WD, fullContent: undefined, loc: undefined, path: 'src/a.ts' },
    ],
    [
      'writeFile',
      { content: 'x', path: 'src/a.ts' },
      'writeFile',
      { content: 'x', cwd: WD, path: 'src/a.ts' },
    ],
    [
      'editFile',
      { file_path: 'a.ts', new_string: 'b', old_string: 'a' },
      'editLocalFile',
      {
        cwd: WD,
        file_path: 'a.ts',
        new_string: 'b',
        old_string: 'a',
        replace_all: undefined,
      },
    ],
    [
      'moveFiles',
      { items: [{ newPath: 'b.ts', oldPath: 'a.ts' }] },
      'moveLocalFiles',
      { cwd: WD, items: [{ newPath: 'b.ts', oldPath: 'a.ts' }] },
    ],
    [
      'listFiles',
      { path: '.' },
      'listLocalFiles',
      { cwd: WD, limit: undefined, path: '.', sortBy: undefined, sortOrder: undefined },
    ],
  ] as const)(
    'forwards the working directory as cwd for %s',
    async (apiName, args, serviceMethod, expected) => {
      const service = createService({
        [serviceMethod]: vi.fn().mockResolvedValue({ replacements: 1, success: true }),
      });
      const runtime = new LocalSystemExecutionRuntime(service);

      await runtime.executeToolCall(apiName, args as Record<string, any>, {
        workingDirectory: WD,
      });

      expect(service[serviceMethod as keyof ILocalSystemService]).toHaveBeenCalledWith(expected);
    },
  );

  it('forwards cwd to readFiles (direct service call path)', async () => {
    const service = createService({
      readLocalFiles: vi.fn().mockResolvedValue([]),
    });
    const runtime = new LocalSystemExecutionRuntime(service);

    await runtime.executeToolCall(
      'readFiles',
      { paths: ['a.ts', 'b.ts'] },
      { workingDirectory: WD },
    );

    expect(service.readLocalFiles).toHaveBeenCalledWith({ cwd: WD, paths: ['a.ts', 'b.ts'] });
  });

  it('anchors an omitted grep scope onto the working directory with full param forwarding', async () => {
    const service = createService({
      grepContent: vi.fn().mockResolvedValue({ matches: [], success: true, total_matches: 0 }),
    });
    const runtime = new LocalSystemExecutionRuntime(service);

    await runtime.executeToolCall(
      'grepContent',
      { '-i': true, 'glob': '**/*.ts', 'pattern': 'foo' },
      { workingDirectory: WD },
    );

    const forwarded = (service.grepContent as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(forwarded).toMatchObject({ '-i': true, 'glob': '**/*.ts', 'pattern': 'foo' });
    expect(forwarded.path ?? forwarded.scope ?? forwarded.cwd).toBe(WD);
  });

  it('resolves glob scope "." to the working directory', async () => {
    const service = createService({
      globFiles: vi.fn().mockResolvedValue({ files: [], success: true, total_files: 0 }),
    });
    const runtime = new LocalSystemExecutionRuntime(service);

    await runtime.executeToolCall(
      'globFiles',
      { pattern: '**/*.ts', scope: '.' },
      { workingDirectory: WD },
    );

    expect(service.globFiles).toHaveBeenCalledWith({ limit: 100, pattern: '**/*.ts', scope: WD });
  });

  it('defaults the searchFiles directory to the working directory', async () => {
    const service = createService({
      searchLocalFiles: vi.fn().mockResolvedValue([]),
    });
    const runtime = new LocalSystemExecutionRuntime(service);

    await runtime.executeToolCall('searchFiles', { keywords: 'foo' }, { workingDirectory: WD });

    expect(service.searchLocalFiles).toHaveBeenCalledWith(
      expect.objectContaining({ directory: WD, keywords: 'foo', limit: 100 }),
    );
  });
});

describe('LocalSystemExecutionRuntime.executeToolCall — dispatch', () => {
  it('normalizes legacy API aliases (readLocalFile → readFile)', async () => {
    const service = createService({
      readLocalFile: vi.fn().mockResolvedValue({ content: 'hi', success: true }),
    });
    const runtime = new LocalSystemExecutionRuntime(service);

    const output = await runtime.executeToolCall('readLocalFile', { path: '/tmp/a.txt' });

    expect(output?.success).toBe(true);
    expect(service.readLocalFile).toHaveBeenCalled();
  });

  it('routes legacy renameLocalFile through the typed renameFile method', async () => {
    const service = createService({
      renameLocalFile: vi.fn().mockResolvedValue({ newPath: '/tmp/b.txt', success: true }),
    });
    const runtime = new LocalSystemExecutionRuntime(service);

    const output = await runtime.executeToolCall('renameLocalFile', {
      newName: 'b.txt',
      path: '/tmp/a.txt',
    });

    expect(output?.success).toBe(true);
    expect(service.renameLocalFile).toHaveBeenCalledWith({ newName: 'b.txt', path: '/tmp/a.txt' });
  });

  it('maps shell_id to commandId and forwards filter/timeout for getCommandOutput', async () => {
    const service = createService({
      getCommandOutput: vi.fn().mockResolvedValue({ exit_code: 0, stdout: '', success: true }),
    });
    const runtime = new LocalSystemExecutionRuntime(service);

    await runtime.executeToolCall('getCommandOutput', {
      filter: 'ERROR',
      shell_id: 'sh-1',
      timeout: 5000,
    });

    expect(service.getCommandOutput).toHaveBeenCalledWith({
      filter: 'ERROR',
      shell_id: 'sh-1',
      timeout: 5000,
    });
  });

  it('returns null for non-local-system tools so callers can fall back', async () => {
    const runtime = new LocalSystemExecutionRuntime(createService());

    expect(await runtime.executeToolCall('runHeteroTask', {})).toBeNull();
  });
});

describe('LocalSystemExecutionRuntime.runCommand', () => {
  it('surfaces a pre-spawn failure reason instead of UNKNOWN_EXEC_ERROR', async () => {
    // A command that never starts has no process, so no stderr and no exit
    // code — the exact shape every Local Sandbox refusal takes. The reason used
    // to be dropped, leaving the user (and the model) with a generic failure
    // and nothing to act on.
    const service = createService({
      runCommand: vi.fn().mockResolvedValue({
        error:
          'Local Sandbox requires a working directory. Set one for this agent (or topic) and run the command again.',
        success: false,
      }),
    });
    const runtime = new LocalSystemExecutionRuntime(service);

    const output = await runtime.runCommand({ command: 'whoami' } as never);

    expect(output.content).toContain('Local Sandbox requires a working directory');
    expect(output.content).not.toContain('UNKNOWN_EXEC_ERROR');
  });

  it('reports whether the command was actually sandboxed', async () => {
    const service = createService({
      runCommand: vi.fn().mockResolvedValue({
        exit_code: 0,
        sandboxed: true,
        stdout: 'srt-sandbox',
        success: true,
      }),
    });
    const runtime = new LocalSystemExecutionRuntime(service);

    const output = await runtime.runCommand({ command: 'whoami' } as never);

    expect((output.state as { sandboxed?: boolean }).sandboxed).toBe(true);
  });
});
