import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ensureWorkspaceLinks } from './ensureWorkspaceLinks';

let workspace: string | undefined;

/**
 * Lays out a repo the way pnpm sees it: `packages/<name>` next to the CLI, with
 * the CLI declaring workspace dependencies on them.
 */
const createWorkspace = (dependencies: Record<string, string>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-workspace-links-'));
  workspace = root;

  const cliDir = path.join(root, 'apps', 'cli');
  fs.mkdirSync(path.join(cliDir, 'node_modules', '@lobechat'), { recursive: true });
  fs.writeFileSync(
    path.join(cliDir, 'package.json'),
    JSON.stringify({ devDependencies: dependencies, name: '@lobehub/cli' }),
  );

  return { cliDir, root };
};

const createPackage = (root: string, name: string) => {
  const packageDir = path.join(root, 'packages', name.replace('@lobechat/', ''));
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name }));

  return packageDir;
};

afterEach(() => {
  if (workspace) fs.rmSync(workspace, { force: true, recursive: true });
  workspace = undefined;
});

describe('ensureWorkspaceLinks', () => {
  it('repoints a dangling link so the bundler can resolve the package', () => {
    const { cliDir, root } = createWorkspace({ '@lobechat/device-control': 'workspace:*' });
    const packageDir = createPackage(root, '@lobechat/device-control');

    // pnpm 12 writes this link with two extra `../` segments when apps/cli is
    // installed from a workspace root that lives elsewhere.
    const linkPath = path.join(cliDir, 'node_modules', '@lobechat', 'device-control');
    fs.symlinkSync('../../../../../../packages/device-control', linkPath, 'dir');
    expect(fs.existsSync(path.join(linkPath, 'package.json'))).toBe(false);

    const result = ensureWorkspaceLinks(cliDir);

    expect(result).toEqual({ missing: [], repaired: ['@lobechat/device-control'] });
    expect(fs.realpathSync(linkPath)).toBe(fs.realpathSync(packageDir));
  });

  it('creates a link that was never written', () => {
    const { cliDir, root } = createWorkspace({ '@lobechat/device-identity': 'workspace:*' });
    const packageDir = createPackage(root, '@lobechat/device-identity');

    const result = ensureWorkspaceLinks(cliDir);

    expect(result.repaired).toEqual(['@lobechat/device-identity']);
    expect(fs.realpathSync(path.join(cliDir, 'node_modules', '@lobechat', 'device-identity'))).toBe(
      fs.realpathSync(packageDir),
    );
  });

  it('leaves healthy links untouched and ignores registry dependencies', () => {
    const { cliDir, root } = createWorkspace({ '@lobechat/utils': 'workspace:*', 'ws': '^8.21.0' });
    const packageDir = createPackage(root, '@lobechat/utils');

    const linkPath = path.join(cliDir, 'node_modules', '@lobechat', 'utils');
    fs.symlinkSync(path.relative(path.dirname(linkPath), packageDir), linkPath, 'dir');

    expect(ensureWorkspaceLinks(cliDir)).toEqual({ missing: [], repaired: [] });
    expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
  });

  it('reports a workspace dependency that has no package directory', () => {
    const { cliDir } = createWorkspace({ '@lobechat/gone': 'workspace:*' });

    expect(ensureWorkspaceLinks(cliDir)).toEqual({ missing: ['@lobechat/gone'], repaired: [] });
  });

  it('finds nested packages such as business/const', () => {
    const { cliDir, root } = createWorkspace({ '@lobechat/business-const': 'workspace:*' });
    const packageDir = path.join(root, 'packages', 'business', 'const');
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({ name: '@lobechat/business-const' }),
    );

    expect(ensureWorkspaceLinks(cliDir).repaired).toEqual(['@lobechat/business-const']);
    expect(fs.realpathSync(path.join(cliDir, 'node_modules', '@lobechat', 'business-const'))).toBe(
      fs.realpathSync(packageDir),
    );
  });
});
