import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installShellResolver } from '../core-loader.js';

let tmp;
let restore;

const writePkg = (dir, name, value) => {
  const pkgDir = path.join(dir, 'node_modules', name);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ main: 'index.js', name }));
  fs.writeFileSync(path.join(pkgDir, 'index.js'), `module.exports = ${JSON.stringify(value)};`);
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-resolver-'));
  writePkg(path.join(tmp, 'shell'), 'a', 'shell-a');
  writePkg(path.join(tmp, 'shell'), '@scope/c', 'shell-c');
  writePkg(tmp, 'a', 'ancestor-a');
  writePkg(path.join(tmp, 'core'), 'b', 'core-b');
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));
  fs.writeFileSync(path.join(tmp, 'core', 'package.json'), JSON.stringify({ type: 'commonjs' }));
  fs.writeFileSync(path.join(tmp, 'core', 'entry.js'), '');
  restore = installShellResolver(path.join(tmp, 'shell', 'node_modules'));
});

afterEach(() => {
  restore();
  fs.rmSync(tmp, { force: true, recursive: true });
});

describe('installShellResolver', () => {
  it('prefers shell packages over ancestor node_modules and leaves core packages alone', () => {
    const req = createRequire(path.join(tmp, 'core', 'entry.js'));
    expect(req('a')).toBe('shell-a');
    expect(req('@scope/c/index.js')).toBe('shell-c');
    expect(req('b')).toBe('core-b');
    expect(req('node:path')).toBe(path);
    expect(() => req('missing')).toThrow(/Cannot find module/);
  });

  it('restores native resolution', () => {
    restore();
    const req = createRequire(path.join(tmp, 'core', 'entry.js'));
    expect(req('a')).toBe('ancestor-a');
  });
});
