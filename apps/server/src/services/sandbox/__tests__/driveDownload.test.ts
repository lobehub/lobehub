// @vitest-environment node
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildDriveDownloadCommand,
  DRIVE_DOWNLOAD_MAX_BYTES,
  DRIVE_DOWNLOAD_URL_EXPIRES_IN,
  DRIVE_PREVIEW_URL_EXPIRES_IN,
  driveDownloadFileName,
  parseDriveDownloadOutput,
  prepareDriveDownload,
} from '../driveDownload';
import { SandboxStorageFilesError } from '../storageFiles';

const hasPython = spawnSync('python3', ['--version']).status === 0;

/**
 * The script the sandbox runs, run here for real: against a folder standing
 * in for the drive's root, uploading to a local server standing in for the
 * presigned URL.
 */
describe.skipIf(!hasPython)('the drive download script', () => {
  let server: Server;
  let uploadUrl: string;
  let received: { body: Buffer; headers: Record<string, unknown> }[];
  let root: string;
  let outside: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        received.push({ body: Buffer.concat(chunks), headers: request.headers });
        response.writeHead(request.url?.includes('fail') ? 403 : 200);
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    uploadUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/upload?sig=a'b"c`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  beforeEach(() => {
    received = [];
    root = mkdtempSync(path.join(tmpdir(), 'drive-root-'));
    outside = mkdtempSync(path.join(tmpdir(), 'drive-outside-'));
    writeFileSync(path.join(outside, 'secret.txt'), 'not yours');

    mkdirSync(path.join(root, 'project/src'), { recursive: true });
    mkdirSync(path.join(root, 'project/empty'), { recursive: true });
    mkdirSync(path.join(root, 'project/private'), { recursive: true });
    writeFileSync(path.join(root, 'project/README.md'), '# hello');
    writeFileSync(path.join(root, 'project/src/index.ts'), 'export {};');
    writeFileSync(path.join(root, 'project/private/token'), 'hidden');
    symlinkSync(outside, path.join(root, 'project/escape'));
    symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'project/secret.txt'));
    writeFileSync(path.join(root, "report q3 'final'.bin"), Buffer.from([0, 1, 2, 255]));
    symlinkSync(outside, path.join(root, 'linked'));
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
    rmSync(outside, { force: true, recursive: true });
  });

  const run = (
    target: string,
    options: {
      fileOnly?: boolean;
      hidden?: string[];
      maxBytes?: number;
      maxFiles?: number;
      url?: string;
    } = {},
  ) => {
    const command = buildDriveDownloadCommand({
      fileOnly: options.fileOnly,
      hidden: options.hidden ?? [],
      maxBytes: options.maxBytes ?? DRIVE_DOWNLOAD_MAX_BYTES,
      maxFiles: options.maxFiles ?? 100,
      path: target,
      uploadHeaders: { 'x-amz-acl': 'public-read' },
      uploadUrl: options.url ?? uploadUrl,
    });
    // Asynchronously, so the server in this process can answer the upload.
    return new Promise<ReturnType<typeof parseDriveDownloadOutput>>((resolve, reject) => {
      const child = spawn('sh', ['-c', command], { cwd: root });
      let stdout = '';
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.on('error', reject);
      child.on('close', () => resolve(parseDriveDownloadOutput(stdout)));
    });
  };

  const zipEntries = (body: Buffer) => {
    const file = path.join(outside, 'received.zip');
    writeFileSync(file, body);
    return execFileSync('python3', [
      '-c',
      'import sys, zipfile; print("\\n".join(sorted(zipfile.ZipFile(sys.argv[1]).namelist())))',
      file,
    ])
      .toString()
      .trim()
      .split('\n');
  };

  it('uploads a file byte for byte, whatever its name holds', async () => {
    const outcome = await run("report q3 'final'.bin");

    expect(outcome).toEqual({
      contentType: 'application/octet-stream',
      kind: 'file',
      ok: true,
      size: 4,
    });
    expect(received).toHaveLength(1);
    expect([...received[0].body]).toEqual([0, 1, 2, 255]);
    expect(received[0].headers['x-amz-acl']).toBe('public-read');
  });

  it('zips a folder under its own name, leaving out links and hidden directories', async () => {
    const outcome = await run('project', { hidden: ['project/private'] });

    expect(outcome).toMatchObject({ contentType: 'application/zip', kind: 'directory', ok: true });
    expect(zipEntries(received[0].body)).toEqual([
      'project/README.md',
      'project/empty/',
      'project/src/index.ts',
    ]);
  });

  it('refuses a path that leads out of the drive, a hidden one, and one that is not there', async () => {
    await expect(run('linked')).resolves.toEqual({ code: 'NOT_FOUND', ok: false });
    await expect(run('project/secret.txt')).resolves.toEqual({ code: 'NOT_FOUND', ok: false });
    await expect(run('project/private', { hidden: ['project/private'] })).resolves.toEqual({
      code: 'NOT_FOUND',
      ok: false,
    });
    await expect(run('missing')).resolves.toEqual({ code: 'NOT_FOUND', ok: false });
    expect(received).toHaveLength(0);
  });

  it('refuses a path that passes through a link, even to a real file', async () => {
    // `linked` points outside the drive; `linked/secret.txt` exists there.
    await expect(run('linked/secret.txt')).resolves.toEqual({ code: 'NOT_FOUND', ok: false });
    expect(received).toHaveLength(0);
  });

  it('packs what each file holds, read through the file itself', async () => {
    await run('project/src');

    const file = path.join(outside, 'src.zip');
    writeFileSync(file, received[0].body);
    const content = execFileSync('python3', [
      '-c',
      'import sys, zipfile; sys.stdout.write(zipfile.ZipFile(sys.argv[1]).read("src/index.ts").decode())',
      file,
    ]).toString();
    expect(content).toBe('export {};');
  });

  // Root reads everything, so there is no unreadable file to make.
  it.skipIf(process.getuid?.() === 0)(
    'fails rather than leaving out a file it cannot read',
    async () => {
      chmodSync(path.join(root, 'project/src/index.ts'), 0o000);

      await expect(run('project', { hidden: ['project/private'] })).resolves.toMatchObject({
        code: 'READ_FAILED',
        ok: false,
        path: 'project/src/index.ts',
      });
      expect(received).toHaveLength(0);
    },
  );

  it('counts directories toward the entry limit, so empty ones cannot run it unbounded', async () => {
    for (let index = 0; index < 5; index += 1)
      mkdirSync(path.join(root, `many/d${index}`), { recursive: true });

    await expect(run('many', { maxFiles: 3 })).resolves.toMatchObject({
      code: 'TOO_LARGE',
      ok: false,
    });
    expect(received).toHaveLength(0);
  });

  it('refuses to pack a folder for a preview, and still copies a file', async () => {
    await expect(run('project', { fileOnly: true })).resolves.toEqual({
      code: 'NOT_A_FILE',
      ok: false,
    });
    expect(received).toHaveLength(0);

    await expect(run('project/README.md', { fileOnly: true })).resolves.toMatchObject({
      contentType: 'text/markdown',
      kind: 'file',
      ok: true,
    });
    expect(received).toHaveLength(1);
  });

  it('refuses a folder over the size limit before packing it', async () => {
    await expect(run('project', { maxBytes: 5 })).resolves.toMatchObject({
      code: 'TOO_LARGE',
      ok: false,
    });
    expect(received).toHaveLength(0);
  });

  it('reports an upload the storage refused', async () => {
    await expect(run('project/README.md', { url: `${uploadUrl}&fail=1` })).resolves.toMatchObject({
      code: 'UPLOAD_FAILED',
      ok: false,
      status: 403,
    });
  });
});

describe('driveDownloadFileName', () => {
  it('names a folder after itself with .zip and a file as it is', () => {
    expect(driveDownloadFileName('a/b/project', 'directory')).toBe('project.zip');
    expect(driveDownloadFileName('a/report.pdf', 'file')).toBe('report.pdf');
  });
});

describe('prepareDriveDownload', () => {
  const fileService = {
    createDownloadUrl: vi.fn(async (key: string, name: string) => `https://cdn/${key}?as=${name}`),
    createPreSignedUrlForPreview: vi.fn(async (key: string) => `https://cdn/${key}?inline`),
    createPreSignedUpload: vi.fn(async (key: string) => ({
      headers: { 'x-amz-acl': 'public-read' },
      url: `https://upload/${key}`,
    })),
    deleteFile: vi.fn(async () => undefined),
    deleteFiles: vi.fn(async () => undefined),
    listFileKeys: vi.fn(async (): Promise<string[]> => []),
  };

  const sandboxAnswering = (stdout: string | undefined, shell = true) => ({
    callTool: vi.fn(async () => ({
      result: stdout === undefined ? null : { exitCode: 0, stdout },
      success: stdout !== undefined,
    })),
    capabilities: { shell } as any,
  });

  beforeEach(() => {
    fileService.createDownloadUrl.mockClear();
    fileService.createPreSignedUrlForPreview.mockClear();
    fileService.createPreSignedUpload.mockClear();
    fileService.deleteFile.mockClear();
    fileService.deleteFiles.mockClear();
    fileService.listFileKeys.mockReset().mockResolvedValue([]);
  });

  it('answers with an attachment link named after the folder', async () => {
    const sandbox = sandboxAnswering(
      'noise\nLOBE_DRIVE_DOWNLOAD_RESULT {"ok":true,"kind":"directory","size":42,"contentType":"application/zip"}\n',
    );

    const result = await prepareDriveDownload({
      fileService,
      hidden: ['project/private'],
      path: 'project',
      sandbox,
    });

    const [key, uploadOptions] = fileService.createPreSignedUpload.mock.calls[0] as unknown as [
      string,
      unknown,
    ];
    expect(uploadOptions).toEqual({ private: true });
    expect(key).toMatch(/^sandbox-drive-downloads\/\d{4}-\d{2}-\d{2}\/[\da-f-]{36}$/);
    expect(fileService.createDownloadUrl).toHaveBeenCalledWith(
      key,
      'project.zip',
      DRIVE_DOWNLOAD_URL_EXPIRES_IN,
    );
    expect(result).toEqual({
      contentType: 'application/zip',
      fileName: 'project.zip',
      kind: 'directory',
      size: 42,
      url: `https://cdn/${key}?as=project.zip`,
    });

    const [tool, params] = sandbox.callTool.mock.calls[0] as unknown as [string, any];
    expect(tool).toBe('runCommand');
    expect(params.command).not.toContain('https://upload');
    const payload = /LOBE_DRIVE_DOWNLOAD='([^']+)'/.exec(params.command)![1];
    expect(JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))).toMatchObject({
      headers: { 'x-amz-acl': 'public-read' },
      hidden: ['project/private'],
      path: 'project',
      uploadUrl: `https://upload/${key}`,
    });
  });

  it('answers a preview with an inline link, and tells the script to refuse a folder', async () => {
    const sandbox = sandboxAnswering(
      'LOBE_DRIVE_DOWNLOAD_RESULT {"ok":true,"kind":"file","size":9,"contentType":"application/pdf"}\n',
    );

    const result = await prepareDriveDownload({
      fileService,
      hidden: [],
      path: 'docs/report.pdf',
      purpose: 'preview',
      sandbox,
    });

    const [key] = fileService.createPreSignedUpload.mock.calls[0] as unknown as [string];
    expect(fileService.createPreSignedUrlForPreview).toHaveBeenCalledWith(
      key,
      DRIVE_PREVIEW_URL_EXPIRES_IN,
    );
    expect(fileService.createDownloadUrl).not.toHaveBeenCalled();
    expect(result).toEqual({
      contentType: 'application/pdf',
      fileName: 'report.pdf',
      kind: 'file',
      size: 9,
      url: `https://cdn/${key}?inline`,
    });

    const [, params] = sandbox.callTool.mock.calls[0] as unknown as [string, any];
    const payload = /LOBE_DRIVE_DOWNLOAD='([^']+)'/.exec(params.command)![1];
    expect(JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))).toMatchObject({
      fileOnly: true,
      path: 'docs/report.pdf',
    });
  });

  it.each([
    ['NOT_A_FILE', 'PREVIEW_NOT_A_FILE'],
    ['NOT_FOUND', 'PATH_NOT_FOUND'],
    ['TOO_LARGE', 'DOWNLOAD_TOO_LARGE'],
    ['UPLOAD_FAILED', 'DOWNLOAD_FAILED'],
  ])('turns the script refusing with %s into %s', async (code, expected) => {
    const sandbox = sandboxAnswering(`LOBE_DRIVE_DOWNLOAD_RESULT {"ok":false,"code":"${code}"}`);

    await expect(
      prepareDriveDownload({ fileService, hidden: [], path: 'a', sandbox }),
    ).rejects.toMatchObject({ code: expected });
    expect(fileService.createDownloadUrl).not.toHaveBeenCalled();
  });

  it('deletes the copy a failed download may have left, and keeps the failure', async () => {
    const sandbox = sandboxAnswering(
      'LOBE_DRIVE_DOWNLOAD_RESULT {"ok":false,"code":"UPLOAD_FAILED"}',
    );

    await expect(
      prepareDriveDownload({ fileService, hidden: [], path: 'a', sandbox }),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
    expect(fileService.deleteFile).toHaveBeenCalledWith(
      fileService.createPreSignedUpload.mock.calls[0][0],
    );
  });

  it('sweeps copies from before yesterday, and keeps the download when the sweep fails', async () => {
    const now = new Date('2026-11-02T00:30:00Z');
    fileService.listFileKeys.mockResolvedValue([
      'sandbox-drive-downloads/2026-10-30/a',
      'sandbox-drive-downloads/2026-10-31/b',
      'sandbox-drive-downloads/2026-11-01/c',
      'sandbox-drive-downloads/2026-11-02/d',
    ]);
    const answer =
      'LOBE_DRIVE_DOWNLOAD_RESULT {"ok":true,"kind":"file","size":1,"contentType":"text/plain"}';

    await prepareDriveDownload({
      fileService,
      hidden: [],
      now,
      path: 'a',
      sandbox: sandboxAnswering(answer),
    });

    expect(fileService.listFileKeys).toHaveBeenCalledWith('sandbox-drive-downloads/');
    expect(fileService.deleteFiles).toHaveBeenCalledWith([
      'sandbox-drive-downloads/2026-10-30/a',
      'sandbox-drive-downloads/2026-10-31/b',
    ]);
    expect(fileService.deleteFile).not.toHaveBeenCalled();

    fileService.listFileKeys.mockRejectedValue(new Error('AccessDenied'));
    await expect(
      prepareDriveDownload({
        fileService,
        hidden: [],
        now,
        path: 'a',
        sandbox: sandboxAnswering(answer),
      }),
    ).resolves.toMatchObject({ fileName: 'a' });
  });

  it('fails when the command never answered', async () => {
    await expect(
      prepareDriveDownload({
        fileService,
        hidden: [],
        path: 'a',
        sandbox: sandboxAnswering(undefined),
      }),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
  });

  it('is unavailable on a sandbox without a shell', async () => {
    const sandbox = sandboxAnswering('', false);

    await expect(
      prepareDriveDownload({ fileService, hidden: [], path: 'a', sandbox }),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_UNAVAILABLE' });
    expect(sandbox.callTool).not.toHaveBeenCalled();
  });

  describe('through the storage service', () => {
    const storageAnswering = (answer: () => Promise<any>) => ({ exportFile: vi.fn(answer) });

    it('exports without a sandbox and links the copy', async () => {
      const storage = storageAnswering(async () => ({
        contentType: 'application/zip',
        kind: 'directory',
        size: 9,
      }));
      const sandbox = sandboxAnswering(undefined);

      const result = await prepareDriveDownload({
        fileService,
        hidden: ['project/private'],
        path: 'project',
        sandbox,
        storage,
      });

      const [key] = fileService.createPreSignedUpload.mock.calls[0] as unknown as [string];
      expect(storage.exportFile).toHaveBeenCalledWith(
        {
          fileOnly: undefined,
          hidden: ['project/private'],
          maxBytes: DRIVE_DOWNLOAD_MAX_BYTES,
          maxFiles: expect.any(Number),
          path: 'project',
          uploadHeaders: { 'x-amz-acl': 'public-read' },
          uploadUrl: `https://upload/${key}`,
        },
        { signal: expect.any(AbortSignal) },
      );
      expect(result).toMatchObject({ fileName: 'project.zip', kind: 'directory', size: 9 });
      expect(sandbox.callTool).not.toHaveBeenCalled();
    });

    it('bounds the export, and fails it without a sandbox when it runs out of time', async () => {
      const storage = storageAnswering(async () => {
        throw new DOMException('The operation timed out.', 'TimeoutError');
      });
      const sandbox = sandboxAnswering(undefined);

      await expect(
        prepareDriveDownload({ fileService, hidden: [], path: 'big', sandbox, storage }),
      ).rejects.toMatchObject({
        code: 'DOWNLOAD_FAILED',
        message: 'DOWNLOAD_FAILED: EXPORT_TIMEOUT',
      });

      const [, options] = storage.exportFile.mock.calls[0] as unknown as [unknown, any];
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(sandbox.callTool).not.toHaveBeenCalled();
      expect(fileService.deleteFile).toHaveBeenCalled();
    });

    it('works on a deployment whose sandbox has no shell', async () => {
      const storage = storageAnswering(async () => ({
        contentType: 'text/plain',
        kind: 'file',
        size: 1,
      }));

      await expect(
        prepareDriveDownload({
          fileService,
          hidden: [],
          path: 'a.txt',
          purpose: 'preview',
          sandbox: sandboxAnswering('', false),
          storage,
        }),
      ).resolves.toMatchObject({ fileName: 'a.txt' });
      expect(storage.exportFile).toHaveBeenCalledWith(
        expect.objectContaining({ fileOnly: true }),
        expect.anything(),
      );
    });

    it('packs in a sandbox when the storage service cannot export', async () => {
      for (const error of [
        new SandboxStorageFilesError('no function', 501, 'EXPORT_UNAVAILABLE'),
        // A storage service from before the route: Not Found, with no code of ours.
        new SandboxStorageFilesError('Not Found', 404),
        new SandboxStorageFilesError('Method Not Allowed', 405),
      ]) {
        const sandbox = sandboxAnswering(
          'LOBE_DRIVE_DOWNLOAD_RESULT {"ok":true,"kind":"file","size":1,"contentType":"text/plain"}',
        );

        await expect(
          prepareDriveDownload({
            fileService,
            hidden: [],
            path: 'a.txt',
            sandbox,
            storage: storageAnswering(async () => {
              throw error;
            }),
          }),
        ).resolves.toMatchObject({ fileName: 'a.txt' });
        expect(sandbox.callTool).toHaveBeenCalledOnce();
      }
    });

    it('answers a refusal in the codes the client translates, and deletes the copy', async () => {
      const cases = [
        ['EXPORT_NOT_FOUND', 404, 'PATH_NOT_FOUND'],
        ['EXPORT_TOO_LARGE', 413, 'DOWNLOAD_TOO_LARGE'],
        ['EXPORT_NOT_A_FILE', 400, 'PREVIEW_NOT_A_FILE'],
        ['EXPORT_UPLOAD_FAILED', 500, 'DOWNLOAD_FAILED'],
        ['EXPORT_READ_FAILED', 500, 'DOWNLOAD_FAILED'],
        ['EXPORT_INTERNAL', 500, 'DOWNLOAD_FAILED'],
        // A request the storage service rejected is ours to fix, not a reason
        // to retry the same copy in a sandbox.
        ['EXPORT_INVALID_PARAMS', 400, 'DOWNLOAD_FAILED'],
        [undefined, 502, 'DOWNLOAD_FAILED'],
      ] as const;

      for (const [code, status, expected] of cases) {
        fileService.deleteFile.mockClear();
        const sandbox = sandboxAnswering(undefined);

        await expect(
          prepareDriveDownload({
            fileService,
            hidden: [],
            path: 'a',
            sandbox,
            storage: storageAnswering(async () => {
              throw new SandboxStorageFilesError('refused', status, code);
            }),
          }),
        ).rejects.toMatchObject({ code: expected });
        expect(sandbox.callTool).not.toHaveBeenCalled();
        expect(fileService.deleteFile).toHaveBeenCalledOnce();
      }
    });
  });
});
