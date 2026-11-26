import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { generateHost, HOST_HTML } from '../generate/host';
import { buildSide } from './viteBuild';

const fixture = path.resolve(import.meta.dirname, '../../test/fixtures/mini-project');
const runtime = path.resolve(import.meta.dirname, '../generate/hostRuntime.tsx');
let outDir: string;

afterAll(() => rm(outDir, { force: true, recursive: true }));

describe('buildSide', () => {
  it('builds the generated host with the revision config and emits the case module', async () => {
    outDir = await mkdtemp(path.join(tmpdir(), 'style-eq-build-'));
    const hostDir = path.join(fixture, '.stylex-synthetic-test');
    await mkdir(hostDir, { recursive: true });
    const moduleFile = path.join(hostDir, 'case.tsx');
    await writeFile(
      moduleFile,
      'export const cases = { \'a.tsx|A#0\': () => <span className="marker-from-case">x</span> };\n',
    );
    await writeFile(path.join(hostDir, 'plan.json'), JSON.stringify([]));
    await writeFile(path.join(hostDir, 'index.html'), HOST_HTML);
    await writeFile(
      path.join(hostDir, 'entry.tsx'),
      generateHost({
        hostWrapper: path.join(fixture, 'host.tsx'),
        modules: [{ file: 'a.tsx', specifier: moduleFile }],
        runtime,
        themeAttribute: 'data-theme',
      }),
    );
    try {
      const result = await buildSide({
        configFile: path.join(fixture, 'style-equivalence.config.ts'),
        hostDir,
        outDir,
        root: fixture,
      });
      expect(result.dist).toBe(outDir);
      const assets = await readdir(path.join(outDir, 'assets'));
      const js = await Promise.all(
        assets
          .filter((name) => name.endsWith('.js'))
          .map((name) => readFile(path.join(outDir, 'assets', name), 'utf8')),
      );
      expect(js.join('\n')).toContain('marker-from-case');
      expect(assets.some((name) => name.endsWith('.css'))).toBe(true);
    } finally {
      await rm(hostDir, { force: true, recursive: true });
    }
  });

  it('reports the build log when the build fails', async () => {
    const hostDir = await mkdtemp(path.join(tmpdir(), 'style-eq-bad-'));
    await writeFile(path.join(hostDir, 'index.html'), HOST_HTML);
    await writeFile(path.join(hostDir, 'entry.tsx'), "import './missing-module';\n");
    await expect(
      buildSide({
        configFile: path.join(fixture, 'style-equivalence.config.ts'),
        hostDir,
        outDir: path.join(hostDir, 'dist'),
        root: fixture,
      }),
    ).rejects.toThrow(/BUILD_FAILED[\s\S]*missing-module/);
    await rm(hostDir, { force: true, recursive: true });
  });
});
