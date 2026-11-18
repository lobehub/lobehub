import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// 本测试确保 packages/model-bank/package.json 的 exports 覆盖 src/aiModels 下的所有文件
describe('model-bank package.json exports should cover all aiModels files', () => {
  const packageRoot = path.resolve(__dirname, '..');
  const aiModelsDir = path.resolve(packageRoot, 'src/aiModels');
  const packageJsonPath = path.resolve(packageRoot, 'package.json');

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    exports?: Record<string, string>;
  };

  const entries = readdirSync(aiModelsDir, { withFileTypes: true });

  /** Provider id → expected export path; a provider split into a directory exports its `index.ts`. */
  const expectedExports = new Map<string, string>([
    ...entries
      .filter((e) => e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts'))
      .map((e) => e.name.replace(/\.ts$/, ''))
      // Exclude non-provider entry files.
      .filter((name) => !['index'].includes(name))
      .map((name): [string, string] => [name, `./src/aiModels/${name}.ts`]),
    ...entries
      .filter((e) => e.isDirectory() && existsSync(path.resolve(aiModelsDir, e.name, 'index.ts')))
      .map((e): [string, string] => [e.name, `./src/aiModels/${e.name}/index.ts`]),
  ]);

  it('every aiModels file should be exported in package.json.exports', () => {
    const exportsMap = packageJson.exports ?? {};

    const missing = [...expectedExports]
      .filter(([name, expectedPath]) => exportsMap[`./${name}`] !== expectedPath)
      .map(([name]) => name);

    if (missing.length > 0) {
      console.error('Missing exports for aiModels files:', missing);
    }

    expect(missing).toEqual([]);
  });
});
