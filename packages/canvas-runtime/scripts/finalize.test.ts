import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, it } from 'vitest';

import { finalizeCanvasRuntime } from './finalize.mjs';

it('emits a content-addressed release without copying assets to the app public directory', async () => {
  const dist = await mkdtemp(path.join(tmpdir(), 'canvas-release-'));
  try {
    for (const file of [
      'canvas-runtime.js',
      'canvas-runtime-highlight.js',
      'canvas-runtime-mermaid.js',
    ])
      await writeFile(path.join(dist, file), 'window.runtime=true;');
    await writeFile(path.join(dist, 'canvas-runtime.css'), 'body{color:inherit}');
    const first = await finalizeCanvasRuntime(dist, 1);
    expect(first.revision).toMatch(/^[\da-f]{64}$/);
    expect(first.files).toHaveLength(3);
    expect(first.revision).toBe(
      createHash('sha256')
        .update(JSON.stringify([1, first.files.map((file) => [file.path, file.sha256, file.size])]))
        .digest('hex'),
    );
    expect(await readFile(path.join(dist, 'canvas-runtime.js'), 'utf8')).toContain(
      'body{color:inherit}',
    );
    expect(JSON.parse(await readFile(path.join(dist, 'manifest.json'), 'utf8'))).toEqual(first);
    const second = await finalizeCanvasRuntime(dist, 1);
    expect(second.revision).toBe(first.revision);
  } finally {
    await rm(dist, { force: true, recursive: true });
  }
});
