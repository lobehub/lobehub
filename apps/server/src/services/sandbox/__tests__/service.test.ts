import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileService } from '@/server/services/file';
import type { MarketService } from '@/server/services/market';

import type { SandboxInitialization } from '../environmentInit';
import type { SandboxProvider, SandboxProviderKind } from '../types';

describe('normalizeSandboxCommandResult', () => {
  it('preserves recreation when the command fails inside a successful response', async () => {
    const { normalizeSandboxCommandResult } = await import('../service');

    expect(
      normalizeSandboxCommandResult({
        result: { exitCode: 1, stderr: 'missing input file', stdout: '' },
        sessionExpiredAndRecreated: true,
        success: true,
      }),
    ).toEqual({
      exitCode: 1,
      output: '',
      sessionExpiredAndRecreated: true,
      stderr: 'missing input file',
      success: false,
    });
  });

  it.each([undefined, false])('does not report recreation for flag %s', async (flag) => {
    const { normalizeSandboxCommandResult } = await import('../service');

    expect(
      normalizeSandboxCommandResult({
        result: { exitCode: 0, stdout: 'output' },
        sessionExpiredAndRecreated: flag,
        success: true,
      }),
    ).toEqual({ exitCode: 0, output: 'output', stderr: undefined, success: true });
  });

  it.each([true, false])('preserves recreation when transport success is %s', async (success) => {
    const { normalizeSandboxCommandResult } = await import('../service');

    expect(
      normalizeSandboxCommandResult({
        error: success ? undefined : { message: 'missing file' },
        result: { exitCode: 0, stdout: 'output' },
        sessionExpiredAndRecreated: true,
        success,
      }),
    ).toMatchObject({ sessionExpiredAndRecreated: true, success });
  });
});

describe('SandboxMiddlewareService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  describe('initializing from an environment', () => {
    const capabilities = {
      backgroundCommands: true,
      exportFile: true,
      files: true,
      languages: ['python'],
      persistentSession: true,
      shell: true,
      skillScripts: true,
    };
    const init = {
      environmentId: 'env-1',
      name: 'Hello',
      sources: [{ url: 'https://github.com/octocat/Hello-World' }],
    };

    const serviceWith = async (stdout: string, initialization: SandboxInitialization = init) => {
      const { SandboxMiddlewareService: TestSandboxMiddlewareService } = await import('../service');
      const callTool = vi.fn(async (name: string, params: Record<string, unknown>) =>
        String(params.command).includes('__lobe_environment_ran')
          ? { result: { exitCode: 0, stderr: '', stdout }, success: true }
          : { result: { exitCode: 0, stderr: '', stdout: `ran ${name}` }, success: true },
      );
      const provider = {
        callTool,
        capabilities,
        exportFileToUploadUrl: vi.fn(),
        kind: 'market',
      } satisfies SandboxProvider;
      const service = new TestSandboxMiddlewareService(provider, {
        marketService: {} as MarketService,
        sandboxInitialization: initialization,
        topicId: 'topic-1',
        userId: 'user-1',
      });

      return { callTool, service };
    };

    it('applies the environment once, before the first tool, and says so in the first shell result', async () => {
      const { callTool, service } = await serviceWith(
        '__lobe_environment_ran\nInitialized from the environment Hello.\n',
      );

      const first = await service.callTool('runCommand', { command: 'ls' });
      await service.callTool('runCommand', { command: 'pwd' });

      const commands = callTool.mock.calls.map(([, params]) => String(params.command));
      expect(commands.filter((command) => command.includes('__lobe_environment_ran'))).toHaveLength(
        1,
      );
      expect(commands[0]).toContain('git clone');
      expect((first.result as { stdout: string }).stdout).toBe(
        '[environment] Initialized from the environment Hello.\n\nran runCommand',
      );
    });

    it('keeps the report for the first shell result when an earlier call only read files', async () => {
      const { service } = await serviceWith(
        '__lobe_environment_ran\nInitializing from the environment Hello failed (exit 7).\n',
      );

      const read = await service.callTool('listFiles', { path: '.' });
      const shell = await service.callTool('runCommand', { command: 'ls' });
      const later = await service.callTool('runCommand', { command: 'pwd' });

      expect(JSON.stringify(read.result)).not.toContain('[environment]');
      expect((shell.result as { stdout: string }).stdout).toBe(
        '[environment] Initializing from the environment Hello failed (exit 7).\n\nran runCommand',
      );
      expect((later.result as { stdout: string }).stdout).toBe('ran runCommand');
    });

    it('says so when the initializer could not reach the sandbox, rather than nothing', async () => {
      const { callTool, service } = await serviceWith('');
      callTool.mockRejectedValueOnce(new Error('gateway down'));

      const result = await service.callTool('runCommand', { command: 'ls' });

      expect((result.result as { stdout: string }).stdout).toBe(
        '[environment] The environment "Hello" could not be applied: the sandbox did not respond. It will be tried again on the next command.\n\nran runCommand',
      );
    });

    it('treats a failed call that printed nothing as unreachable, not as initialized', async () => {
      const { callTool, service } = await serviceWith('');
      callTool.mockResolvedValueOnce({ result: null, success: false } as any);

      const result = await service.callTool('runCommand', { command: 'ls' });

      expect((result.result as { stdout: string }).stdout).toContain('could not be applied');
    });

    it('adds nothing to the result when the directory was already initialized', async () => {
      const { service } = await serviceWith('');

      const result = await service.callTool('runCommand', { command: 'ls' });

      expect((result.result as { stdout: string }).stdout).toBe('ran runCommand');
    });

    it("exports the environment's variables into every shell command the conversation runs", async () => {
      const { callTool, service } = await serviceWith('', {
        ...init,
        env: { LOBEHUB_ADMIN_URL: 'https://admin.example.com' },
      });

      await service.callTool('runCommand', { command: 'printenv LOBEHUB_ADMIN_URL' });
      await service.callTool('execScript', { command: 'node admin.js' });
      await service.callTool('runCommand', { background: true, command: 'claude -p hi' });
      await service.callTool('listFiles', { path: '.' });

      const [initCall, ...calls] = callTool.mock.calls;
      expect(String(initCall[1].command)).toContain('__lobe_environment_ran');
      expect(calls.map(([name, params]) => [name, params])).toEqual([
        [
          'runCommand',
          {
            command:
              "export LOBEHUB_ADMIN_URL='https://admin.example.com'\nprintenv LOBEHUB_ADMIN_URL",
          },
        ],
        [
          'execScript',
          { command: "export LOBEHUB_ADMIN_URL='https://admin.example.com'\nnode admin.js" },
        ],
        [
          'runCommand',
          {
            background: true,
            command: "export LOBEHUB_ADMIN_URL='https://admin.example.com'\nclaude -p hi",
          },
        ],
        ['listFiles', { path: '.' }],
      ]);
    });

    it('exports the variables of an environment with nothing to clone or set up, without an initializer', async () => {
      const { callTool, service } = await serviceWith('', {
        env: { REGION: 'us' },
        environmentId: 'env-1',
        name: 'Vars only',
        sources: [],
      });

      await service.callTool('runCommand', { command: 'echo $REGION' });

      expect(callTool.mock.calls).toEqual([
        ['runCommand', { command: "export REGION='us'\necho $REGION" }],
      ]);
    });
  });

  it('uploads provider exports through the shared file record flow', async () => {
    const { SandboxMiddlewareService: TestSandboxMiddlewareService } = await import('../service');
    const exportFileToUploadUrl = vi.fn(async () => ({
      result: { mime_type: 'text/plain' },
      success: true,
    }));
    const provider = {
      capabilities: {
        backgroundCommands: true,
        exportFile: true,
        files: true,
        languages: ['python'],
        persistentSession: true,
        shell: true,
        skillScripts: true,
      },
      callTool: vi.fn(),
      exportFileToUploadUrl,
      kind: 'onlyboxes',
    } satisfies SandboxProvider;

    const fileService = {
      createPreSignedUpload: vi.fn(async () => ({
        headers: { 'x-amz-acl': 'public-read' },
        url: 'https://uploads.example.com/put',
      })),
      createFileRecord: vi.fn(async () => ({ fileId: 'file-1', url: '/f/file-1' })),
      getFileMetadata: vi.fn(async () => ({
        contentLength: 42,
        contentType: 'text/csv',
      })),
    } as unknown as FileService;

    const service = new TestSandboxMiddlewareService(provider, {
      fileService,
      marketService: {} as MarketService,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await service.exportAndUploadFile('/workspace/result.csv', 'result.csv');

    expect(result).toMatchObject({
      fileId: 'file-1',
      filename: 'result.csv',
      mimeType: 'text/csv',
      size: 42,
      success: true,
      url: '/f/file-1',
    });
    expect(exportFileToUploadUrl).toHaveBeenCalledWith({
      filename: 'result.csv',
      path: '/workspace/result.csv',
      uploadHeaders: { 'x-amz-acl': 'public-read' },
      uploadUrl: 'https://uploads.example.com/put',
    });
    expect(fileService.createFileRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        fileType: 'text/csv',
        name: 'result.csv',
        size: 42,
        url: expect.stringMatching(
          /^code-interpreter-exports\/\d{4}-\d{2}-\d{2}\/topic-1\/result\.csv$/,
        ),
      }),
    );
  });

  it('keys the object on storageName while keeping filename as the display name', async () => {
    const { SandboxMiddlewareService: TestSandboxMiddlewareService } = await import('../service');
    const exportFileToUploadUrl = vi.fn(async () => ({
      result: { mime_type: 'text/csv' },
      success: true,
    }));
    const provider = {
      capabilities: {
        backgroundCommands: true,
        exportFile: true,
        files: true,
        languages: ['python'],
        persistentSession: true,
        shell: true,
        skillScripts: true,
      },
      callTool: vi.fn(),
      exportFileToUploadUrl,
      kind: 'onlyboxes',
    } satisfies SandboxProvider;

    const fileService = {
      createPreSignedUpload: vi.fn(async () => ({
        headers: {},
        url: 'https://uploads.example.com/put',
      })),
      createFileRecord: vi.fn(async () => ({ fileId: 'file-1', url: '/f/file-1' })),
      getFileMetadata: vi.fn(async () => ({ contentLength: 42, contentType: 'text/csv' })),
    } as unknown as FileService;

    const service = new TestSandboxMiddlewareService(provider, {
      fileService,
      marketService: {} as MarketService,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await service.exportAndUploadFile('/workspace/result.csv', 'result.csv', {
      storageName: 'deadbeefdeadbeef-result.csv',
    });

    // The returned/display name is the clean basename, never the storage key.
    expect(result.filename).toBe('result.csv');
    // The storage key (both the presigned upload key and the file record url)
    // uses storageName so the object is collision-proof.
    expect(fileService.createPreSignedUpload).toHaveBeenCalledWith(
      expect.stringMatching(
        /^code-interpreter-exports\/\d{4}-\d{2}-\d{2}\/topic-1\/deadbeefdeadbeef-result\.csv$/,
      ),
    );
    expect(fileService.createFileRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'result.csv',
        url: expect.stringMatching(/\/deadbeefdeadbeef-result\.csv$/),
      }),
    );
    // The provider still receives the display filename (unchanged contract).
    expect(exportFileToUploadUrl).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'result.csv', path: '/workspace/result.csv' }),
    );
  });

  it('normalizes provider export failures before storage metadata is read', async () => {
    const provider = {
      capabilities: {
        backgroundCommands: true,
        exportFile: true,
        files: true,
        languages: ['python'],
        persistentSession: true,
        shell: true,
        skillScripts: true,
      },
      callTool: vi.fn(),
      exportFileToUploadUrl: vi.fn(async () => ({
        error: { message: 'no such file', name: 'not_found' },
        success: false,
      })),
      kind: 'onlyboxes',
    } satisfies SandboxProvider;

    const { SandboxMiddlewareService } = await import('../service');
    const fileService = {
      createFileRecord: vi.fn(),
      createPreSignedUpload: vi.fn(async () => ({ url: 'https://uploads.example.com/put' })),
      getFileMetadata: vi.fn(),
    } as unknown as FileService;

    const service = new SandboxMiddlewareService(provider, {
      fileService,
      marketService: {} as MarketService,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await service.exportAndUploadFile('/workspace/missing.txt', 'missing.txt');

    expect(result).toMatchObject({
      error: { message: 'no such file', name: 'not_found' },
      filename: 'missing.txt',
      success: false,
    });
    expect(fileService.getFileMetadata).not.toHaveBeenCalled();
    expect(fileService.createFileRecord).not.toHaveBeenCalled();
  });
});

describe('SandboxMiddlewareService readFile images', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  const createProvider = ({
    callTool = vi.fn(),
    exportFile = true,
    exportFileToUploadUrl = vi.fn(async () => ({
      result: { mime_type: 'image/png' },
      success: true,
    })),
    kind = 'onlyboxes',
  }: {
    callTool?: SandboxProvider['callTool'];
    exportFile?: boolean;
    exportFileToUploadUrl?: SandboxProvider['exportFileToUploadUrl'];
    kind?: SandboxProviderKind;
  } = {}) =>
    ({
      capabilities: {
        backgroundCommands: true,
        exportFile,
        files: true,
        languages: ['python'],
        persistentSession: true,
        shell: true,
        skillScripts: true,
      },
      callTool,
      exportFileToUploadUrl,
      kind,
    }) satisfies SandboxProvider;

  const createFileService = ({ contentLength = 1234, contentType = 'image/png' } = {}) =>
    ({
      createFileRecord: vi.fn(async () => ({ fileId: 'file-1', url: '/f/file-1' })),
      createPreSignedUpload: vi.fn(async () => ({
        headers: {},
        url: 'https://uploads.example.com/put',
      })),
      getFileMetadata: vi.fn(async () => ({ contentLength, contentType })),
    }) as unknown as FileService;

  const createService = async (
    provider: SandboxProvider,
    {
      agentShareVisitor,
      fileService,
    }: {
      agentShareVisitor?: { shareId: string; visitorUserId: string };
      fileService?: FileService;
    } = {},
  ) => {
    const { SandboxMiddlewareService } = await import('../service');

    return new SandboxMiddlewareService(provider, {
      agentShareVisitor,
      fileService,
      marketService: {} as MarketService,
      topicId: 'topic-1',
      userId: 'user-1',
    });
  };

  it.each(['readFile', 'readLocalFile'])(
    'intercepts %s for an image path and uploads it for preview',
    async (toolName) => {
      const provider = createProvider();
      const fileService = createFileService();
      const service = await createService(provider, { fileService });

      const result = await service.callTool(toolName, { path: '/mnt/data/chart.png' });

      expect(provider.callTool).not.toHaveBeenCalled();
      expect(provider.exportFileToUploadUrl).toHaveBeenCalledWith(
        expect.objectContaining({ filename: 'chart.png', path: '/mnt/data/chart.png' }),
      );
      expect(fileService.createPreSignedUpload).toHaveBeenCalledWith(
        expect.stringMatching(/\/topic-1\/[0-9a-f-]{36}-chart\.png$/),
      );
      expect(result).toEqual({
        result: {
          content: '[Image: chart.png]',
          fileType: 'image/png',
          filename: 'chart.png',
          imageFileId: 'file-1',
          imageUrl: '/f/file-1',
          isImage: true,
        },
        success: true,
      });
      // Ordinary runs stamp no share provenance on the file record.
      expect(fileService.createFileRecord.mock.calls[0][0]).not.toHaveProperty('metadata');
    },
  );

  it('stamps agentShare provenance on the file record for visitor runs', async () => {
    const provider = createProvider();
    const fileService = createFileService();
    const service = await createService(provider, {
      agentShareVisitor: { shareId: 'share-1', visitorUserId: 'visitor-1' },
      fileService,
    });

    const result = await service.callTool('readFile', { path: '/mnt/data/chart.png' });

    expect(provider.callTool).not.toHaveBeenCalled();
    expect(fileService.createFileRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { agentShare: { shareId: 'share-1', visitorUserId: 'visitor-1' } },
      }),
    );
    expect(result.result?.imageUrl).toBe('/f/file-1');
  });

  it('intercepts image reads for market providers too', async () => {
    const provider = createProvider({ kind: 'market' });
    const fileService = createFileService();
    const service = await createService(provider, { fileService });

    const result = await service.callTool('readLocalFile', { path: '/mnt/data/chart.png' });

    expect(provider.callTool).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      result: {
        content: '[Image: chart.png]',
        fileType: 'image/png',
        filename: 'chart.png',
        imageFileId: 'file-1',
        imageUrl: '/f/file-1',
        isImage: true,
      },
      success: true,
    });
  });

  it('passes non-image reads through to the provider', async () => {
    const callTool = vi.fn(async () => ({
      result: { content: 'hello' },
      success: true,
    }));
    const provider = createProvider({ callTool });
    const fileService = createFileService();
    const service = await createService(provider, { fileService });

    const params = { path: '/mnt/data/notes.txt' };
    const result = await service.callTool('readLocalFile', params);

    expect(provider.callTool).toHaveBeenCalledWith('readLocalFile', params);
    expect(result).toEqual({ result: { content: 'hello' }, success: true });
    expect(provider.exportFileToUploadUrl).not.toHaveBeenCalled();
  });

  it('passes svg reads through to the provider instead of treating them as images', async () => {
    const callTool = vi.fn(async () => ({
      result: { content: '<svg></svg>' },
      success: true,
    }));
    const provider = createProvider({ callTool });
    const fileService = createFileService();
    const service = await createService(provider, { fileService });

    const result = await service.callTool('readLocalFile', { path: '/mnt/data/icon.svg' });

    expect(provider.callTool).toHaveBeenCalledWith('readLocalFile', {
      path: '/mnt/data/icon.svg',
    });
    expect(result).toEqual({ result: { content: '<svg></svg>' }, success: true });
    expect(provider.exportFileToUploadUrl).not.toHaveBeenCalled();
  });

  it('returns an upload-unavailable placeholder without a fileService', async () => {
    const provider = createProvider();
    const service = await createService(provider);

    const result = await service.callTool('readLocalFile', { path: '/mnt/data/chart.png' });

    expect(provider.callTool).not.toHaveBeenCalled();
    expect(provider.exportFileToUploadUrl).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      result: { filename: 'chart.png', fileType: 'image/png', isImage: true },
      success: true,
    });
    expect(result.result?.content).toContain('upload unavailable');
    expect(result.result?.imageUrl).toBeUndefined();
  });

  it('returns an upload-unavailable placeholder when the provider cannot export files', async () => {
    const provider = createProvider({ exportFile: false });
    const fileService = createFileService();
    const service = await createService(provider, { fileService });

    const result = await service.callTool('readLocalFile', { path: '/mnt/data/chart.png' });

    expect(provider.callTool).not.toHaveBeenCalled();
    expect(provider.exportFileToUploadUrl).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      result: { filename: 'chart.png', isImage: true },
      success: true,
    });
    expect(result.result?.content).toContain('upload unavailable');
    expect(result.result?.imageUrl).toBeUndefined();
  });

  it('degrades to a placeholder when the export fails', async () => {
    const provider = createProvider({
      exportFileToUploadUrl: vi.fn(async () => ({
        error: { message: 'no such file' },
        success: false,
      })),
    });
    const fileService = createFileService();
    const service = await createService(provider, { fileService });

    const result = await service.callTool('readLocalFile', { path: '/mnt/data/chart.png' });

    expect(provider.callTool).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.result?.content).toContain('no such file');
    expect(result.result?.isImage).toBe(true);
    expect(result.result?.imageUrl).toBeUndefined();
  });

  // The execInSandbox route turns an auth error into the Market re-auth
  // prompt; a placeholder would swallow it.
  it('keeps export auth failures as failed tool results', async () => {
    const provider = createProvider({
      exportFileToUploadUrl: vi.fn(async () => ({
        error: { message: 'token expired', name: 'token_expired' },
        success: false,
      })),
    });
    const fileService = createFileService();
    const service = await createService(provider, { fileService });

    const result = await service.callTool('readLocalFile', { path: '/mnt/data/chart.png' });

    expect(result).toMatchObject({
      error: { name: 'token_expired' },
      success: false,
    });
    expect(result.result?.imageUrl).toBeUndefined();
  });

  // `getToolAccessDeniedError` refusals carry `kind: 'stop'` — degrading them
  // to a placeholder would let the model retry a call that must halt the run.
  it('keeps access-denied export failures as failed tool results', async () => {
    const accessDeniedError = {
      code: 'FORBIDDEN',
      hint: 'Stop the affected operation and report this error.',
      kind: 'stop' as const,
      message: 'Tool access was denied',
    };
    const provider = createProvider({
      exportFileToUploadUrl: vi.fn(async () => ({
        error: accessDeniedError,
        success: false,
      })),
    });
    const fileService = createFileService();
    const service = await createService(provider, { fileService });

    const result = await service.callTool('readLocalFile', { path: '/mnt/data/chart.png' });

    expect(result).toMatchObject({
      error: { kind: 'stop' },
      success: false,
    });
    expect(result.result?.imageUrl).toBeUndefined();
  });

  it('rejects images above the preview size limit', async () => {
    const provider = createProvider();
    const fileService = createFileService({ contentLength: 11 * 1024 * 1024 });
    const service = await createService(provider, { fileService });

    const result = await service.callTool('readLocalFile', { path: '/mnt/data/chart.png' });

    expect(result.success).toBe(true);
    expect(result.result?.content).toMatch(/^Error: Image file is too large/);
    expect(result.result?.isImage).toBe(true);
    expect(result.result?.imageUrl).toBeUndefined();
  });

  it('treats uppercase image extensions as images', async () => {
    const provider = createProvider();
    const fileService = createFileService();
    const service = await createService(provider, { fileService });

    const result = await service.callTool('readLocalFile', { path: '/mnt/data/PHOTO.PNG' });

    expect(provider.callTool).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      result: {
        content: '[Image: PHOTO.PNG]',
        fileType: 'image/png',
        filename: 'PHOTO.PNG',
        imageFileId: 'file-1',
        imageUrl: '/f/file-1',
        isImage: true,
      },
      success: true,
    });
  });
});
