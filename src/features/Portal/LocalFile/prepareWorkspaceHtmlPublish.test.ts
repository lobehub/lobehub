import * as packModule from '@lobechat/html-artifact';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getWorkspaceHtmlPublishSizeBytes,
  notifyWorkspaceHtmlPublishBlocked,
  prepareWorkspaceHtmlPublish,
  publishPreparedWorkspaceHtml,
} from './prepareWorkspaceHtmlPublish';

const readWorkspaceAsset = vi.hoisted(() => vi.fn());
const readExternalAssetForPublish = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { error: toastError, success: toastSuccess },
}));

vi.mock('./readWorkspaceAsset', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    readWorkspaceAsset: (...args: unknown[]) => readWorkspaceAsset(...args),
  };
});

vi.mock('./readExternalAssetForPublish', () => ({
  readExternalAssetForPublish: (...args: unknown[]) => readExternalAssetForPublish(...args),
}));

describe('prepareWorkspaceHtmlPublish', () => {
  beforeEach(() => {
    readWorkspaceAsset.mockReset();
    readExternalAssetForPublish.mockReset();
    toastError.mockReset();
    toastSuccess.mockReset();
  });

  it('packs provided HTML without reading the file', async () => {
    const plan = await prepareWorkspaceHtmlPublish({
      content: '<html><title>Demo</title></html>',
      filePath: '/repo/index.html',
      workingDirectory: '/repo',
    });

    expect('blocked' in plan).toBe(false);
    if ('blocked' in plan) return;

    expect(plan.gathered.title).toBe('Demo');
    expect(plan.packed.html).toContain('Demo');
    expect(readWorkspaceAsset).not.toHaveBeenCalled();
  });

  it('reads the file when content is not provided', async () => {
    readWorkspaceAsset.mockResolvedValue({
      ok: true,
      text: '<html><title>From disk</title></html>',
    });

    const plan = await prepareWorkspaceHtmlPublish({
      filePath: '/repo/pages/index.html',
      workingDirectory: '/repo',
    });

    expect(readWorkspaceAsset).toHaveBeenCalledWith({
      deviceId: undefined,
      path: '/repo/pages/index.html',
      sandboxTopicId: undefined,
      workingDirectory: '/repo',
    });
    expect('blocked' in plan).toBe(false);
    if ('blocked' in plan) return;
    expect(plan.gathered.title).toBe('From disk');
  });

  it('uses the publish-only reader for external refs and the normal reader inside the workspace', async () => {
    readWorkspaceAsset.mockResolvedValue({
      bytes: new TextEncoder().encode('console.log(1)'),
      contentType: 'text/javascript',
      ok: true,
      text: 'console.log(1)',
    });
    readExternalAssetForPublish.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'image/png',
      ok: true,
    });
    const input = {
      content: '<html><script src="../app.js"></script><img src="../../outside/logo.png"></html>',
      filePath: '/repo/pages/index.html',
      workingDirectory: '/repo',
    };

    const blocked = await prepareWorkspaceHtmlPublish(input);
    expect(blocked).toMatchObject({
      blocked: 'outside-workspace',
      escaped: [{ absolutePath: '/outside/logo.png', hrefs: ['../../outside/logo.png'] }],
    });
    expect(readWorkspaceAsset).toHaveBeenCalledWith({
      deviceId: undefined,
      path: '/repo/app.js',
      sandboxTopicId: undefined,
      workingDirectory: '/repo',
    });
    readWorkspaceAsset.mockClear();

    const ready = await prepareWorkspaceHtmlPublish({ ...input, allowExternalReads: true });
    expect('blocked' in ready).toBe(false);
    expect(readExternalAssetForPublish).toHaveBeenCalledWith({
      deviceId: undefined,
      path: '/outside/logo.png',
      sandboxTopicId: undefined,
      workingDirectory: '/repo',
    });
    expect(readWorkspaceAsset).toHaveBeenCalledWith({
      deviceId: undefined,
      path: '/repo/app.js',
      sandboxTopicId: undefined,
      workingDirectory: '/repo',
    });
    if ('blocked' in ready) return;
    expect(ready.packed.html).not.toContain('../../outside/logo.png');
  });

  it('keeps unresolved as a defensive fallback for an unexpected pack result', async () => {
    const pack = vi.spyOn(packModule, 'packWorkspaceHtmlDocument').mockReturnValueOnce({
      html: '<html></html>',
      inlinedPaths: [],
      sidecars: [],
      unresolvedHrefs: ['unexpected.png'],
    });

    await expect(
      prepareWorkspaceHtmlPublish({
        content: '<html></html>',
        filePath: '/repo/index.html',
        workingDirectory: '/repo',
      }),
    ).resolves.toEqual({ blocked: 'unresolved', unresolvedHrefs: ['unexpected.png'] });

    pack.mockRestore();
  });

  it('does not toast for outside-workspace because the caller owns its modal', async () => {
    notifyWorkspaceHtmlPublishBlocked({
      blocked: 'outside-workspace',
      escaped: [],
      gathered: {} as never,
    });

    expect(toastError).not.toHaveBeenCalled();
  });

  it('returns unreadable when the HTML file cannot be loaded', async () => {
    readWorkspaceAsset.mockResolvedValue({ ok: false, reason: 'missing' });

    await expect(
      prepareWorkspaceHtmlPublish({
        filePath: '/repo/missing.html',
        workingDirectory: '/repo',
      }),
    ).resolves.toEqual({ blocked: 'unreadable' });
  });

  it('measures the packed HTML and decoded sidecars sent to hosting', () => {
    expect(
      getWorkspaceHtmlPublishSizeBytes({
        gathered: {} as never,
        packed: {
          html: '页',
          inlinedPaths: [],
          sidecars: [
            {
              content: 'AQID',
              contentType: 'image/png',
              encoding: 'base64',
              path: 'hero.png',
            },
            {
              content: 'ok',
              contentType: 'text/css',
              encoding: 'utf8',
              path: 'app.css',
            },
          ],
          unresolvedHrefs: [],
        },
      }),
    ).toBe(8);
  });

  it('lets the commercial layer consume a known publish error without a generic toast', async () => {
    const plan = await prepareWorkspaceHtmlPublish({
      content: '<html><title>Demo</title></html>',
      filePath: '/repo/index.html',
      workingDirectory: '/repo',
    });
    if ('blocked' in plan) throw new Error('expected ready plan');
    const error = new Error('ARTIFACT_DEPLOYMENT_LIMIT_REACHED:3:3');
    const onError = vi.fn(() => true);

    await expect(
      publishPreparedWorkspaceHtml({
        onError,
        plan,
        publish: vi.fn().mockRejectedValue(error),
        topicId: 'topic-1',
      }),
    ).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledWith(error);
    expect(toastError).not.toHaveBeenCalled();
  });
});
