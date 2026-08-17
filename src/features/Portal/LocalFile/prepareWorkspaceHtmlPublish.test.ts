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

  it('packs provided HTML and looks up an existing deployment', async () => {
    const getExisting = vi.fn(async () => ({
      identifier: 'workspace-html-index-html',
      publicUrl: 'https://demo.lobe.page',
    }));

    const plan = await prepareWorkspaceHtmlPublish({
      content: '<html><title>Demo</title></html>',
      filePath: '/repo/index.html',
      getExisting,
      topicId: 'tpc_1',
      workingDirectory: '/repo',
    });

    expect('blocked' in plan).toBe(false);
    if ('blocked' in plan) return;

    expect(plan.hasExisting).toBe(true);
    expect(plan.gathered.title).toBe('Demo');
    expect(getExisting).toHaveBeenCalledWith({
      identifier: plan.gathered.identifier,
      topicId: 'tpc_1',
    });
    expect(readWorkspaceAsset).not.toHaveBeenCalled();
  });

  it('reads the file when content is not provided', async () => {
    readWorkspaceAsset.mockResolvedValue({
      ok: true,
      text: '<html><title>From disk</title></html>',
    });

    const plan = await prepareWorkspaceHtmlPublish({
      filePath: '/repo/pages/index.html',
      topicId: 'tpc_1',
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
    expect(plan.hasExisting).toBe(false);
  });

  it('returns unreadable when the HTML file cannot be loaded', async () => {
    readWorkspaceAsset.mockResolvedValue({ ok: false, reason: 'missing' });

    await expect(
      prepareWorkspaceHtmlPublish({
        filePath: '/repo/missing.html',
        topicId: 'tpc_1',
        workingDirectory: '/repo',
      }),
    ).resolves.toEqual({ blocked: 'unreadable' });
  });
});
