import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

for (const app of ['cli', 'desktop']) {
  const cliRoot = fileURLToPath(new URL(`../../apps/${app}/`, import.meta.url));
  test(`the standalone ${app} workspace contains every transitive workspace dependency`, async () => {
    const config = parse(await readFile(path.join(cliRoot, 'pnpm-workspace.yaml'), 'utf8'));
    const packages = await Promise.all(
      config.packages.map(async (relative) =>
        JSON.parse(await readFile(path.resolve(cliRoot, relative, 'package.json'), 'utf8')),
      ),
    );
    const names = new Set(packages.map((pkg) => pkg.name));
    for (const pkg of packages) {
      for (const [name, version] of Object.entries({
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.optionalDependencies,
      })) {
        if (typeof version === 'string' && version.startsWith('workspace:'))
          assert.ok(
            names.has(name),
            `${pkg.name} requires missing ${app} workspace package ${name}`,
          );
      }
    }
  });
}
