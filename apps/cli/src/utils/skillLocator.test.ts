import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findCliRoot, locateBundledSkill } from './skillLocator';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'skill-locator-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeCliPackage(cliRoot: string, version = '1.2.3') {
  mkdirSync(cliRoot, { recursive: true });
  writeFileSync(
    path.join(cliRoot, 'package.json'),
    JSON.stringify({ name: '@lobehub/cli', version }),
  );
}

describe('findCliRoot', () => {
  it('finds the package root from a built dist/ layout', () => {
    const cliRoot = path.join(root, 'node_modules', '@lobehub', 'cli');
    writeCliPackage(cliRoot);
    const distDir = path.join(cliRoot, 'dist');
    mkdirSync(distDir, { recursive: true });

    expect(findCliRoot(distDir)).toBe(cliRoot);
  });

  it('finds the package root from the monorepo dev entry (src/) layout', () => {
    const cliRoot = path.join(root, 'apps', 'cli');
    writeCliPackage(cliRoot);
    const srcDir = path.join(cliRoot, 'src');
    mkdirSync(srcDir, { recursive: true });

    expect(findCliRoot(srcDir)).toBe(cliRoot);
  });

  it('ignores intermediate package.json files that are not @lobehub/cli', () => {
    const cliRoot = path.join(root, 'apps', 'cli');
    writeCliPackage(cliRoot);
    const utilsDir = path.join(cliRoot, 'src', 'utils');
    mkdirSync(utilsDir, { recursive: true });
    writeFileSync(
      path.join(cliRoot, 'src', 'package.json'),
      JSON.stringify({ name: 'not-the-cli' }),
    );

    expect(findCliRoot(utilsDir)).toBe(cliRoot);
  });

  it('returns undefined when no matching package.json exists up to the filesystem root', () => {
    const dir = path.join(root, 'some', 'unrelated', 'dir');
    mkdirSync(dir, { recursive: true });

    expect(findCliRoot(dir)).toBeUndefined();
  });
});

describe('locateBundledSkill', () => {
  it('resolves cliRoot, skillDir, and version from a simulated package layout', () => {
    const cliRoot = path.join(root, 'node_modules', '@lobehub', 'cli');
    writeCliPackage(cliRoot, '9.9.9');
    const skillDir = path.join(cliRoot, 'skills', 'agent-testing');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, 'SKILL.md'), '# agent-testing');
    const distDir = path.join(cliRoot, 'dist');
    mkdirSync(distDir, { recursive: true });

    const result = locateBundledSkill('agent-testing', distDir);

    expect(result.cliRoot).toBe(cliRoot);
    expect(result.skillDir).toBe(skillDir);
    expect(result.version).toBe('9.9.9');
  });

  it('throws when the package root cannot be found', () => {
    const dir = path.join(root, 'nowhere');
    mkdirSync(dir, { recursive: true });

    expect(() => locateBundledSkill('agent-testing', dir)).toThrow(/package root/);
  });

  it('throws when the package root exists but the skill directory is missing', () => {
    const cliRoot = path.join(root, 'node_modules', '@lobehub', 'cli');
    writeCliPackage(cliRoot);
    const distDir = path.join(cliRoot, 'dist');
    mkdirSync(distDir, { recursive: true });

    expect(() => locateBundledSkill('agent-testing', distDir)).toThrow(/not found/);
  });

  it('resolves against the real apps/cli agent-testing skill by default', () => {
    const result = locateBundledSkill();
    expect(result.skillDir.endsWith(path.join('skills', 'agent-testing'))).toBe(true);
  });
});
