// @vitest-environment node
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildDriveDownloadCommand,
  DRIVE_DOWNLOAD_MAX_BYTES,
  DRIVE_DOWNLOAD_URL_EXPIRES_IN,
  driveDownloadFileName,
  parseDriveDownloadOutput,
  prepareDriveDownload,
} from '../driveDownload';

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
    options: { hidden?: string[]; maxBytes?: number; url?: string } = {},
  ) => {
    const command = buildDriveDownloadCommand({
      hidden: options.hidden ?? [],
      maxBytes: options.maxBytes ?? DRIVE_DOWNLOAD_MAX_BYTES,
      maxFiles: 100,
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
    createPreSignedUpload: vi.fn(async (key: string) => ({
      headers: { 'x-amz-acl': 'public-read' },
      url: `https://upload/${key}`,
    })),
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
    fileService.createPreSignedUpload.mockClear();
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

    const key = fileService.createPreSignedUpload.mock.calls[0][0];
    expect(key).toMatch(/^sandbox-drive-downloads\/\d{4}-\d{2}-\d{2}\/[\da-f-]{36}$/);
    expect(fileService.createDownloadUrl).toHaveBeenCalledWith(
      key,
      'project.zip',
      DRIVE_DOWNLOAD_URL_EXPIRES_IN,
    );
    expect(result).toEqual({
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

  it.each([
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
});
