import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prepareWorkspaceHtmlPublish } from './prepareWorkspaceHtmlPublish';

const readWorkspaceAsset = vi.hoisted(() => vi.fn());

vi.mock('./readWorkspaceAsset', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    readWorkspaceAsset: (...args: unknown[]) => readWorkspaceAsset(...args),
  };
});

describe('prepareWorkspaceHtmlPublish', () => {
  beforeEach(() => {
    readWorkspaceAsset.mockReset();
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

  it('returns unreadable when the HTML file cannot be loaded', async () => {
    readWorkspaceAsset.mockResolvedValue({ ok: false, reason: 'missing' });

    await expect(
      prepareWorkspaceHtmlPublish({
        filePath: '/repo/missing.html',
        workingDirectory: '/repo',
      }),
    ).resolves.toEqual({ blocked: 'unreadable' });
  });
});
