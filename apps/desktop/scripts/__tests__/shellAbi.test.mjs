import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computeShellAbi } from '../shellAbi.mjs';

const LOCK = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      foo:
        specifier: ^1.0.0
        version: 1.0.0

packages:

  '@scope/bar@2.0.0':
    resolution: {integrity: sha512-bar}

  foo@1.0.0:
    resolution: {integrity: sha512-foo}
    engines: {node: '>=14'}

  unrelated@3.0.0:
    resolution: {integrity: sha512-unrelated}

snapshots:

  foo@1.0.0: {}
`;

let root;
const write = (file, content) => {
  const abs = path.join(root, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
};
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
const abi = (publicKey = 'KEY') => computeShellAbi({ publicKey, root });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-abi-'));
  write(
    'apps/desktop/package.json',
    JSON.stringify({
      dependencies: { '@scope/bar': '^2.0.0', 'foo': '^1.0.0' },
      devDependencies: { '@anthropic-ai/sandbox-runtime': '0.0.1', 'electron': '40.0.0' },
      version: '1.2.3',
    }),
  );
  write('apps/desktop/pnpm-lock.yaml', LOCK);
  write('apps/desktop/shell/main.js', 'require("./core-loader")');
  write('apps/desktop/shell/abi.json', '{"shellAbi":"x"}');
  write('apps/desktop/shell/__tests__/x.test.mjs', 'test');
  write('apps/desktop/build/icon.png', 'png');
  write('apps/desktop/build/icon-beta.png', 'beta-png');
  write('apps/desktop/build/Icon.Assets.car', 'car');
  write('apps/desktop/electron-builder.mjs', 'export default {}');
  write('packages/native/binding.gyp', '{}');
  write('packages/native/src/a.cc', 'int main() {}');
  write('packages/pure/index.js', 'pure');
  git('init', '-q');
  git('add', '-A');
});

afterEach(() => fs.rmSync(root, { force: true, recursive: true }));

describe('computeShellAbi', () => {
  it('returns a stable 64-hex hash for the same inputs', () => {
    const first = abi();
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(abi()).toBe(first);
  });

  it('changes when a shell file, native package, lock entry or public key changes', () => {
    const base = abi();

    write('apps/desktop/shell/main.js', 'changed');
    const afterShell = abi();
    expect(afterShell).not.toBe(base);

    write('packages/native/src/a.cc', 'changed');
    const afterNative = abi();
    expect(afterNative).not.toBe(afterShell);

    write('apps/desktop/pnpm-lock.yaml', LOCK.replace('sha512-foo', 'sha512-foo2'));
    const afterLock = abi();
    expect(afterLock).not.toBe(afterNative);

    expect(abi('OTHER')).not.toBe(afterLock);
  });

  it('ignores abi.json, shell tests, untracked files, non-native packages and unrelated lock entries', () => {
    const base = abi();
    write('apps/desktop/shell/abi.json', '{"shellAbi":"y"}');
    write('apps/desktop/shell/__tests__/x.test.mjs', 'changed');
    write('apps/desktop/shell/untracked.js', 'new');
    write('packages/pure/index.js', 'changed');
    write('apps/desktop/pnpm-lock.yaml', LOCK.replace('sha512-unrelated', 'sha512-unrelated2'));
    expect(abi()).toBe(base);
  });

  it('ignores the channel-swapped icon targets but not their variants', () => {
    const base = abi();
    write('apps/desktop/build/icon.png', 'beta-png');
    write('apps/desktop/build/Icon.icns', 'beta-icns');
    write('apps/desktop/build/icon.ico', 'beta-ico');
    expect(abi()).toBe(base);
    write('apps/desktop/build/icon-beta.png', 'changed');
    expect(abi()).not.toBe(base);
    write('apps/desktop/build/icon-beta.png', 'beta-png');
    write('apps/desktop/build/Icon.Assets.car', 'changed');
    expect(abi()).not.toBe(base);
  });

  it('normalizes CRLF and whitespace in the public key', () => {
    expect(abi('KEY\r\n')).toBe(abi('KEY'));
  });
});
