import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Regression: Deploy Canary job "Build and push control-plane image" failed with
 * `Headless installation requires a pnpm-lock.yaml file` after `pnpm i --frozen-lockfile`,
 * then `ERR_PNPM_CONFIG_CONFLICT_BUILT_DEPENDENCIES` after `dangerouslyAllowAllBuilds`.
 * This repo disables the lockfile (`.npmrc` / `pnpm-workspace.yaml`) and already lists
 * `onlyBuiltDependencies`.
 */
describe('control-plane Dockerfile install', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8');

  it('does not use --frozen-lockfile or dangerouslyAllowAllBuilds', () => {
    expect(read('.npmrc')).toMatch(/^lockfile=false$/m);
    expect(read('pnpm-workspace.yaml')).toMatch(/^lockfile:\s*false$/m);
    const dockerfile = read('apps/aico-control-plane/Dockerfile');
    expect(dockerfile).not.toMatch(/pnpm i[^\n]*--frozen-lockfile/);
    expect(dockerfile).not.toMatch(/--config\.dangerouslyAllowAllBuilds/);
  });
});
