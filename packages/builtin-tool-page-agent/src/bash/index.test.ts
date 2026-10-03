import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

describe('page bash bundle', () => {
  it('does not pull optional language runtimes into the server bundle', async () => {
    const optionalRuntimes = ['sql.js', 'typescript', 'quickjs-emscripten', 'run'];
    const result = await build({
      bundle: true,
      entryPoints: [fileURLToPath(new URL('./index.ts', import.meta.url))],
      external: [
        '@lobechat/editor-runtime',
        '@mongodb-js/zstd',
        'node-liblzma',
        ...optionalRuntimes,
      ],
      format: 'esm',
      metafile: true,
      platform: 'node',
      write: false,
    });

    const imports = Object.values(result.metafile.outputs).flatMap((output) =>
      output.imports.map((dependency) => dependency.path),
    );
    expect(imports.filter((dependency) => optionalRuntimes.includes(dependency))).toEqual([]);
    expect(
      Object.keys(result.metafile.inputs).filter((path) =>
        /cpython|sqlite3-worker|js-exec-worker/.test(path),
      ),
    ).toEqual([]);
  });
});
