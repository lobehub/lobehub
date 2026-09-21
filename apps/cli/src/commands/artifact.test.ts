import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerArtifactCommand } from './artifact';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    market: {
      deployments: {
        commitWorkspaceHtmlUpload: { mutate: vi.fn() },
        prepareWorkspaceHtmlUpload: { mutate: vi.fn() },
      },
    },
  },
}));

const { getTrpcClient: mockGetTrpcClient } = vi.hoisted(() => ({
  getTrpcClient: vi.fn(),
}));

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../settings', () => ({ resolveServerUrl: () => 'https://app.lobehub.com' }));

describe('artifact publish', () => {
  let workingDirectory: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-artifact-'));
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: true, status: 200, statusText: 'OK' } as Response);

    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockTrpcClient.market.deployments.prepareWorkspaceHtmlUpload.mutate.mockReset();
    mockTrpcClient.market.deployments.commitWorkspaceHtmlUpload.mutate
      .mockReset()
      .mockResolvedValue({ data: { id: 'dep-1', publicUrl: 'https://example.com/p' } });
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    fetchSpy.mockRestore();
    fs.rmSync(workingDirectory, { force: true, recursive: true });
  });

  const run = async (args: string[]) => {
    const program = new Command();
    program.exitOverride();
    registerArtifactCommand(program);
    await program.parseAsync(['node', 'lh', 'artifact', 'publish', ...args]);
  };

  const prepareReturns = (files: { path: string }[]) => {
    mockTrpcClient.market.deployments.prepareWorkspaceHtmlUpload.mutate.mockResolvedValue({
      data: {
        files: files.map((file) => ({
          headers: { 'Content-Type': 'application/octet-stream' },
          path: file.path,
          uploadUrl: `https://upload.example.com${file.path}`,
        })),
        uploadId: 'upload-1',
      },
    });
  };

  it('bundles a sibling stylesheet and uploads every prepared file', async () => {
    const site = path.join(workingDirectory, 'site');
    fs.mkdirSync(site);
    fs.writeFileSync(
      path.join(site, 'index.html'),
      '<title>Demo</title><link rel="stylesheet" href="./app.css">',
    );
    fs.writeFileSync(path.join(site, 'app.css'), `body{content:"${'x'.repeat(40_000)}"}`);

    prepareReturns([{ path: '/index.html' }, { path: '/app.css' }]);

    await run([path.join(site, 'index.html'), '--root', site]);

    const prepared =
      mockTrpcClient.market.deployments.prepareWorkspaceHtmlUpload.mutate.mock.calls[0][0];
    expect(prepared.title).toBe('Demo');
    expect(prepared.files.map((file: { path: string }) => file.path)).toEqual([
      '/index.html',
      '/app.css',
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(mockTrpcClient.market.deployments.commitWorkspaceHtmlUpload.mutate).toHaveBeenCalledWith(
      {
        uploadId: 'upload-1',
      },
    );
  });

  it('reaches assets above the entry directory when --root allows it', async () => {
    fs.mkdirSync(path.join(workingDirectory, 'pages'));
    fs.mkdirSync(path.join(workingDirectory, 'images'));
    fs.writeFileSync(
      path.join(workingDirectory, 'pages', 'index.html'),
      '<title>Up</title><img src="../images/logo.png">',
    );
    fs.writeFileSync(path.join(workingDirectory, 'images', 'logo.png'), 'png-bytes');

    prepareReturns([{ path: '/index.html' }]);

    await run([path.join(workingDirectory, 'pages', 'index.html'), '--root', workingDirectory]);

    expect(mockTrpcClient.market.deployments.prepareWorkspaceHtmlUpload.mutate).toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('refuses an entry outside the root instead of publishing it', async () => {
    const outside = path.join(workingDirectory, 'outside.html');
    fs.writeFileSync(outside, '<title>Nope</title>');
    fs.mkdirSync(path.join(workingDirectory, 'root'));

    await run([outside, '--root', path.join(workingDirectory, 'root')]);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(
      mockTrpcClient.market.deployments.prepareWorkspaceHtmlUpload.mutate,
    ).not.toHaveBeenCalled();
  });

  const manifestPath = () => path.join(workingDirectory, '.lobehub', 'artifacts.json');

  const readManifest = () => JSON.parse(fs.readFileSync(manifestPath(), 'utf8'));

  const writeManifest = (artifacts: Record<string, unknown>) => {
    fs.mkdirSync(path.dirname(manifestPath()), { recursive: true });
    fs.writeFileSync(manifestPath(), JSON.stringify({ artifacts, version: 1 }));
  };

  describe('deployment binding', () => {
    beforeEach(() => {
      fs.writeFileSync(path.join(workingDirectory, 'index.html'), '<title>Bound</title>');
      prepareReturns([{ path: '/index.html' }]);
    });

    const publish = (...extra: string[]) =>
      run([path.join(workingDirectory, 'index.html'), '--root', workingDirectory, ...extra]);

    it('creates a deployment and records the binding when none exists', async () => {
      await publish();

      const call =
        mockTrpcClient.market.deployments.prepareWorkspaceHtmlUpload.mutate.mock.calls[0][0];
      expect(call.target).toEqual({ kind: 'create' });
      expect(call.idempotencyKey).toEqual(expect.any(String));
      expect(readManifest().artifacts['index.html']).toEqual({ deploymentId: 'dep-1' });
    });

    it('prints the product share URL rather than the raw hosting URL', async () => {
      await publish();

      const output = consoleSpy.mock.calls.flat().join('\n');
      expect(output).toContain('https://app.lobehub.com/share/artifact/dep-1');
      expect(output).not.toContain('https://example.com/p');
    });

    it('emits the product share URL as publicUrl in JSON output', async () => {
      await publish('--json');

      const payload = JSON.parse(
        consoleSpy.mock.calls
          .flat()
          .filter((value): value is string => typeof value === 'string')
          .join('\n'),
      );
      expect(payload.publicUrl).toBe('https://app.lobehub.com/share/artifact/dep-1');
      expect(payload.id).toBe('dep-1');
    });

    it('republishes to the bound deployment instead of creating another', async () => {
      writeManifest({ 'index.html': { deploymentId: 'dep-existing' } });

      await publish();

      const call =
        mockTrpcClient.market.deployments.prepareWorkspaceHtmlUpload.mutate.mock.calls[0][0];
      expect(call.target).toEqual({ deploymentId: 'dep-existing', kind: 'deployment' });
      // An update needs no key: a retry costs a revision, never a second site.
      expect(call.idempotencyKey).toBeUndefined();
    });

    it('--new creates a separate deployment and rebinds to it', async () => {
      writeManifest({ 'index.html': { deploymentId: 'dep-old' } });

      await publish('--new');

      const call =
        mockTrpcClient.market.deployments.prepareWorkspaceHtmlUpload.mutate.mock.calls[0][0];
      expect(call.target).toEqual({ kind: 'create' });
      expect(readManifest().artifacts['index.html']).toEqual({ deploymentId: 'dep-1' });
    });

    it('--deployment targets an id for this run without touching the manifest', async () => {
      writeManifest({ 'index.html': { deploymentId: 'dep-bound' } });

      await publish('--deployment', 'dep-oneoff');

      const call =
        mockTrpcClient.market.deployments.prepareWorkspaceHtmlUpload.mutate.mock.calls[0][0];
      expect(call.target).toEqual({ deploymentId: 'dep-oneoff', kind: 'deployment' });
      expect(readManifest().artifacts['index.html']).toEqual({ deploymentId: 'dep-bound' });
    });

    it('rejects --new together with --deployment', async () => {
      await publish('--new', '--deployment', 'dep-x');

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(
        mockTrpcClient.market.deployments.prepareWorkspaceHtmlUpload.mutate,
      ).not.toHaveBeenCalled();
    });

    it('reuses a pending create key so a lost response cannot mint a second site', async () => {
      writeManifest({ 'index.html': { pendingCreateKey: 'key-from-a-lost-response' } });

      await publish();

      const call =
        mockTrpcClient.market.deployments.prepareWorkspaceHtmlUpload.mutate.mock.calls[0][0];
      expect(call.idempotencyKey).toBe('key-from-a-lost-response');
    });

    it('records the pending key before sending, so a crash mid-publish is recoverable', async () => {
      mockTrpcClient.market.deployments.prepareWorkspaceHtmlUpload.mutate.mockRejectedValueOnce(
        new Error('network died'),
      );

      await expect(publish()).rejects.toThrow('network died');

      expect(readManifest().artifacts['index.html'].pendingCreateKey).toEqual(expect.any(String));
    });
  });
});
