import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// 本测试确保 packages/model-bank/package.json 的 exports 覆盖 src/aiModels 下的所有文件
describe('model-bank package.json exports should cover all aiModels files', () => {
  const packageRoot = path.resolve(__dirname, '..');
  const aiModelsDir = path.resolve(packageRoot, 'src/aiModels');
  const packageJsonPath = path.resolve(packageRoot, 'package.json');

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
    exports?: Record<string, string>;
  };

  const allModelFiles = readdirSync(aiModelsDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => f.replace(/\.ts$/, ''))
    // 排除非 provider 文件，如 index、类型声明等
    .filter((name) => !['index'].includes(name));

  it('every aiModels file should be exported in package.json.exports', () => {
    const exportsMap = packageJson.exports ?? {};

    const missing = allModelFiles.filter((name) => {
      const key = `./${name}`;
      const expectedPath = `./src/aiModels/${name}.ts`;
      return !(key in exportsMap) || exportsMap[key] !== expectedPath;
    });

    if (missing.length > 0) {
      console.error('Missing exports for aiModels files:', missing);
    }

    expect(missing).toEqual([]);
  });
});
