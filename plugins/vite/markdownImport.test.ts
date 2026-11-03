import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { viteMarkdownImport } from './markdownImport';

describe('viteMarkdownImport', () => {
  it('rewrites bare markdown imports into raw string modules', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'vite-markdown-import-'));
    const markdownPath = join(tempDir, 'sample.md');
    const markdownContent = '# hello\n\nThis is markdown.\n';

    await writeFile(markdownPath, markdownContent);

    const plugin = viteMarkdownImport();
    const resolve = vi.fn().mockResolvedValue({ id: markdownPath });

    const resolved = await plugin.resolveId?.call(
      { resolve } as never,
      './sample.md',
      join(tempDir, 'entry.ts'),
      {},
    );

    expect(resolved).toEqual({
      id: `${markdownPath}?lobe-md-import`,
      moduleSideEffects: false,
    });

    const loaded = await plugin.load?.call({} as never, `${markdownPath}?lobe-md-import`);

    expect(loaded).toBe(`export default ${JSON.stringify(markdownContent)};`);

    await rm(tempDir, { force: true, recursive: true });
  });

  it('leaves explicit markdown queries untouched', async () => {
    const plugin = viteMarkdownImport();

    const resolved = await plugin.resolveId?.call(
      { resolve: vi.fn() } as never,
      './sample.md?raw',
      '/tmp/entry.ts',
      {},
    );

    expect(resolved).toBeNull();
  });
});
